import { describe, expect, it } from "vitest";
import { findAttackPaths, type AttackPathInput } from "../attackPaths";
import type { RBACFinding } from "../api";

function pod(ns: string, name: string, labels: Record<string, string>, opts: { sa?: string; automount?: boolean; rs?: string; hash?: string } = {}) {
  return {
    metadata: {
      name,
      namespace: ns,
      labels: { ...labels, ...(opts.hash ? { "pod-template-hash": opts.hash } : {}) },
      ownerReferences: opts.rs ? [{ kind: "ReplicaSet", name: opts.rs, controller: true }] : [],
    },
    spec: { serviceAccountName: opts.sa, automountServiceAccountToken: opts.automount, containers: [{ name: "app", image: "shop/api:1" }] },
  };
}

function svc(ns: string, name: string, type: string, selector: Record<string, string>) {
  return { metadata: { name, namespace: ns }, spec: { type, selector } };
}

function ingress(ns: string, name: string, host: string, service: string) {
  return { metadata: { name, namespace: ns }, spec: { rules: [{ host, http: { paths: [{ path: "/", backend: { service: { name: service } } }] } }] } };
}

function vulnReport(ns: string, rs: string, severities: string[]) {
  return {
    metadata: {
      name: `replicaset-${rs}-app`,
      labels: {
        "trivy-operator.resource.kind": "ReplicaSet",
        "trivy-operator.resource.name": rs,
        "trivy-operator.resource.namespace": ns,
        "trivy-operator.container.name": "app",
      },
    },
    report: { vulnerabilities: severities.map((s, i) => ({ vulnerabilityID: `CVE-${i}`, severity: s })) },
  };
}

function rbac(subject: string, severity: "high" | "medium", title: string): RBACFinding {
  return { severity, title, subject, roleRef: "ClusterRole/x", why: "" };
}

const apiPod = pod("shop", "api-7d9-abc", { app: "api" }, { sa: "api", rs: "api-7d9", hash: "7d9" });

function base(over: Partial<AttackPathInput> = {}): AttackPathInput {
  return {
    pods: [apiPod],
    services: [svc("shop", "api", "LoadBalancer", { app: "api" })],
    ingresses: [],
    networkPolicies: [],
    vulnReports: [vulnReport("shop", "api-7d9", ["CRITICAL", "HIGH", "LOW"])],
    rbacFindings: [rbac("ServiceAccount shop/api", "high", "Can read Secrets cluster-wide")],
    ...over,
  };
}

describe("findAttackPaths", () => {
  it("chains an exposed, vulnerable workload whose token can read secrets", () => {
    const [p, ...rest] = findAttackPaths(base());
    expect(rest).toEqual([]);
    expect(p).toMatchObject({
      workload: { ns: "shop", kind: "Deployment", name: "api" },
      serviceAccount: "shop/api",
      entry: [{ via: "LoadBalancer", name: "api" }],
      ingressIsolated: false,
      vulns: { critical: 1, high: 1 },
      tokenMounted: true,
      complete: true,
    });
    expect(p!.privileges.map((x) => x.title)).toEqual(["Can read Secrets cluster-wide"]);
    expect(p!.steps).toEqual([
      "Reachable from outside the cluster via LoadBalancer Service shop/api",
      "No NetworkPolicy restricts ingress to these pods",
      "Runs images with 1 critical and 1 high CVEs",
      "Mounts the shop/api ServiceAccount token. RBAC findings for it: Can read Secrets cluster-wide",
    ]);
  });

  it("ignores workloads nobody outside the cluster can reach", () => {
    expect(findAttackPaths(base({ services: [svc("shop", "api", "ClusterIP", { app: "api" })] }))).toEqual([]);
  });

  it("treats an Ingress backend as an entry point", () => {
    const [p] = findAttackPaths(base({ services: [svc("shop", "api", "ClusterIP", { app: "api" })], ingresses: [ingress("shop", "public", "shop.example.com", "api")] }));
    expect(p!.entry).toEqual([{ via: "Ingress", name: "public", detail: "shop.example.com" }]);
  });

  it("needs a foothold or a payoff: exposure alone is not a path", () => {
    expect(findAttackPaths(base({ vulnReports: [], rbacFindings: [] }))).toEqual([]);
  });

  it("drops the privilege step when the token is not mounted", () => {
    const p = findAttackPaths(base({ pods: [pod("shop", "api-7d9-abc", { app: "api" }, { sa: "api", rs: "api-7d9", hash: "7d9", automount: false })] }))[0]!;
    expect(p.tokenMounted).toBe(false);
    expect(p.privileges).toEqual([]);
    expect(p.complete).toBe(false);
    expect(findAttackPaths(base({ vulnReports: [], pods: [pod("shop", "x", { app: "api" }, { sa: "api", automount: false })] }))).toEqual([]);
  });

  it("notes a NetworkPolicy that isolates the pods for ingress", () => {
    const np = { metadata: { name: "api-only", namespace: "shop" }, spec: { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"] } };
    const p = findAttackPaths(base({ networkPolicies: [np] }))[0]!;
    expect(p.ingressIsolated).toBe(true);
    expect(p.steps[1]).toBe("Ingress is restricted by NetworkPolicy shop/api-only");
  });

  it("uses the default ServiceAccount and skips non-privilege RBAC findings", () => {
    const p = findAttackPaths(
      base({
        pods: [pod("shop", "api-7d9-abc", { app: "api" }, { rs: "api-7d9", hash: "7d9" })],
        rbacFindings: [rbac("ServiceAccount shop/default", "medium", "ServiceAccount subject does not exist"), rbac("ServiceAccount shop/default", "medium", "Can exec into pods")],
      }),
    )[0]!;
    expect(p.serviceAccount).toBe("shop/default");
    expect(p.privileges.map((x) => x.title)).toEqual(["Can exec into pods"]);
  });

  it("ranks complete chains above partial ones", () => {
    const webPod = pod("shop", "web-1", { app: "web" }, { sa: "web" });
    const paths = findAttackPaths(
      base({
        pods: [webPod, apiPod],
        services: [svc("shop", "api", "LoadBalancer", { app: "api" }), svc("shop", "web", "NodePort", { app: "web" })],
        rbacFindings: [rbac("ServiceAccount shop/api", "high", "Can read Secrets cluster-wide"), rbac("ServiceAccount shop/web", "high", "Can create pods")],
      }),
    );
    expect(paths.map((p) => `${p.workload.name}:${p.complete}`)).toEqual(["api:true", "web-1:false"]);
    expect(paths[1]!.workload.kind).toBe("Pod");
  });
});
