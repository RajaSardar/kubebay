import { describe, expect, it } from "vitest";
import { findAttackPaths, type AttackPathInput, type AttackPathRule } from "../attackPaths";
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

  describe("NetworkPolicy that admits the entry's traffic", () => {
    const policy = (ingress: unknown[] | undefined) => ({
      metadata: { name: "api-np", namespace: "shop" },
      spec: { podSelector: { matchLabels: { app: "api" } }, policyTypes: ["Ingress"], ...(ingress ? { ingress } : {}) },
    });
    const controller = {
      metadata: { name: "ingress-nginx-controller-1", namespace: "ingress-nginx", labels: { "app.kubernetes.io/name": "ingress-nginx", "app.kubernetes.io/component": "controller" } },
      spec: { containers: [{ name: "controller" }] },
      status: { podIP: "10.0.5.7" },
    };
    const viaIngress = (np: Record<string, unknown>, extra: Partial<AttackPathInput> = {}) =>
      findAttackPaths(
        base({
          pods: [apiPod, controller],
          services: [svc("shop", "api", "ClusterIP", { app: "api" })],
          ingresses: [ingress("shop", "public", "shop.example.com", "api")],
          namespaces: [{ metadata: { name: "ingress-nginx", labels: { "kubernetes.io/metadata.name": "ingress-nginx" } } }],
          networkPolicies: [np],
          ...extra,
        }),
      ).find((p) => p.workload.name === "api")!;

    it("is not isolation when it lets the ingress controller in", () => {
      const p = viaIngress(policy([{ from: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "ingress-nginx" } } }] }]));
      expect(p.ingressIsolated).toBe(false);
      expect(p.steps[1]).toBe("NetworkPolicy shop/api-np selects these pods but admits traffic from the ingress controller");
    });

    it("is isolation when its rules leave the ingress controller out", () => {
      const p = viaIngress(policy([{ from: [{ podSelector: { matchLabels: { app: "web" } } }] }]));
      expect(p.ingressIsolated).toBe(true);
      expect(p.steps[1]).toBe("Ingress is restricted by NetworkPolicy shop/api-np");
    });

    it("matches the controller by IP when the rule is an ipBlock", () => {
      expect(viaIngress(policy([{ from: [{ ipBlock: { cidr: "10.0.5.0/24" } }] }])).ingressIsolated).toBe(false);
      expect(viaIngress(policy([{ from: [{ ipBlock: { cidr: "10.0.5.0/24", except: ["10.0.5.7/32"] } }] }])).ingressIsolated).toBe(true);
    });

    it("can't call it isolated when it can't find the ingress controller", () => {
      const p = viaIngress(policy([{ from: [{ podSelector: { matchLabels: { app: "web" } } }] }]), { pods: [apiPod] });
      expect(p.ingressIsolated).toBe(false);
      expect(p.steps[1]).toBe("NetworkPolicy shop/api-np selects these pods, but the ingress controller's pods weren't found to check it");
    });

    it("an empty from, or any ipBlock, admits LoadBalancer traffic", () => {
      for (const rules of [[{}], [{ from: [] }], [{ from: [{ ipBlock: { cidr: "0.0.0.0/0" } }] }]]) {
        expect(findAttackPaths(base({ networkPolicies: [policy(rules)] }))[0]!.ingressIsolated).toBe(false);
      }
      expect(findAttackPaths(base({ networkPolicies: [policy([{ from: [{ podSelector: {} }] }])] }))[0]!.ingressIsolated).toBe(true);
    });
  });

  describe("Gateway API routes", () => {
    const route = {
      metadata: { name: "shop-route", namespace: "shop" },
      spec: { parentRefs: [{ name: "public", namespace: "infra" }], hostnames: ["shop.example.com"], rules: [{ backendRefs: [{ name: "api", port: 80 }] }] },
    };

    it("treats an HTTPRoute backend as an entry point", () => {
      const [p] = findAttackPaths(base({ services: [svc("shop", "api", "ClusterIP", { app: "api" })], httpRoutes: [route] }));
      expect(p!.entry).toEqual([{ via: "Gateway", name: "shop-route", gateway: "infra/public", detail: "shop.example.com" }]);
      expect(p!.steps[0]).toBe("Reachable from outside the cluster via HTTPRoute shop/shop-route on Gateway infra/public (shop.example.com)");
    });

    it("ignores routes to other services and non-Service backends", () => {
      const other = { ...route, spec: { ...route.spec, rules: [{ backendRefs: [{ name: "web" }, { name: "api", kind: "ServiceImport", group: "multicluster.x-k8s.io" }] }] } };
      expect(findAttackPaths(base({ services: [svc("shop", "api", "ClusterIP", { app: "api" })], httpRoutes: [other] }))).toEqual([]);
    });
  });

  describe("node breakout", () => {
    it("counts a privileged container or a hostPath volume as a payoff", () => {
      const escape = {
        ...apiPod,
        spec: {
          ...apiPod.spec,
          containers: [{ name: "app", image: "shop/api:1", securityContext: { privileged: true } }],
          volumes: [{ name: "sock", hostPath: { path: "/var/run/docker.sock" } }],
        },
      };
      const p = findAttackPaths(base({ pods: [escape], rbacFindings: [] }))[0]!;
      expect(p.nodeEscape).toEqual(["privileged container app", "hostPath /var/run/docker.sock"]);
      expect(p.complete).toBe(true);
      expect(p.steps).toContain("Can break out to the node: privileged container app; hostPath /var/run/docker.sock");
    });
  });

  describe("Secrets the token can read", () => {
    const rbacSnap = (bindings: { cluster?: boolean; ns?: string; role: string; subject: { kind: string; name: string; ns?: string } }[], rules: Record<string, AttackPathRule[]>) => ({
      roles: Object.entries(rules)
        .filter(([k]) => k.startsWith("Role:"))
        .map(([k, r]) => ({ name: k.split(":")[2]!, ns: k.split(":")[1], kind: "Role", rules: r })),
      clusterRoles: Object.entries(rules)
        .filter(([k]) => k.startsWith("ClusterRole:"))
        .map(([k, r]) => ({ name: k.split(":")[1]!, kind: "ClusterRole", rules: r })),
      roleBindings: bindings.filter((b) => !b.cluster).map((b, i) => ({ name: `rb${i}`, ns: b.ns, kind: "RoleBinding", roleRef: b.role, subjects: [b.subject] })),
      clusterRoleBindings: bindings.filter((b) => b.cluster).map((b, i) => ({ name: `crb${i}`, kind: "ClusterRoleBinding", roleRef: b.role, subjects: [b.subject] })),
    });
    const sa = { kind: "ServiceAccount", name: "api", ns: "shop" };
    const readSecrets = (extra: Partial<AttackPathRule> = {}): AttackPathRule => ({ verbs: ["get"], apiGroups: [""], resources: ["secrets"], ...extra });

    it("names cluster-wide Secret access and counts it as a payoff", () => {
      const p = findAttackPaths(base({ vulnReports: [], rbacFindings: [], rbac: rbacSnap([{ cluster: true, role: "ClusterRole:reader", subject: sa }], { "ClusterRole:reader": [readSecrets({ verbs: ["list"] })] }) }))[0]!;
      expect(p.secretAccess).toEqual(["every namespace"]);
      expect(p.steps).toContain("The token can read Secrets in every namespace");
    });

    it("scopes a RoleBinding to its namespace and keeps resourceNames", () => {
      const snap = rbacSnap(
        [
          { ns: "shop", role: "Role:db", subject: { kind: "ServiceAccount", name: "api" } },
          { ns: "billing", role: "ClusterRole:view-secrets", subject: sa },
        ],
        { "Role:shop:db": [readSecrets({ resourceNames: ["db-creds"] })], "ClusterRole:view-secrets": [readSecrets({ apiGroups: ["*"], resources: ["*"] })] },
      );
      const p = findAttackPaths(base({ vulnReports: [], rbacFindings: [], rbac: snap }))[0]!;
      expect(p.secretAccess).toEqual(["shop/db-creds", "billing"]);
    });

    it("counts groups every ServiceAccount is in, and ignores write-only or other-resource rules", () => {
      const snap = rbacSnap(
        [
          { cluster: true, role: "ClusterRole:all-sa", subject: { kind: "Group", name: "system:serviceaccounts:shop" } },
          { cluster: true, role: "ClusterRole:writer", subject: sa },
        ],
        { "ClusterRole:all-sa": [readSecrets()], "ClusterRole:writer": [readSecrets({ verbs: ["create"] }), { verbs: ["get"], apiGroups: [""], resources: ["configmaps"] }] },
      );
      expect(findAttackPaths(base({ vulnReports: [], rbacFindings: [], rbac: snap }))[0]!.secretAccess).toEqual(["every namespace"]);
    });

    it("needs the token mounted", () => {
      const snap = rbacSnap([{ cluster: true, role: "ClusterRole:reader", subject: sa }], { "ClusterRole:reader": [readSecrets()] });
      const noToken = pod("shop", "api-7d9-abc", { app: "api" }, { sa: "api", rs: "api-7d9", hash: "7d9", automount: false });
      expect(findAttackPaths(base({ pods: [noToken], vulnReports: [], rbacFindings: [], rbac: snap }))).toEqual([]);
    });
  });
});
