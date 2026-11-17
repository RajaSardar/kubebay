import { describe, expect, it } from "vitest";
import { computeBestPractices, type BestPracticesInput } from "../bestPractices";

type O = Record<string, unknown>;

function dep(ns: string, name: string, replicas: number, container: O = {}, labels: Record<string, string> = { app: name }): O {
  return {
    metadata: { namespace: ns, name },
    spec: {
      replicas,
      template: { metadata: { labels }, spec: { containers: [{ name: "c", ...container }] } },
    },
  };
}
const ok = {
  resources: { requests: { cpu: "1m", memory: "1Mi" }, limits: { memory: "1Mi" } },
  readinessProbe: { httpGet: { path: "/" } },
};
const pdb = (ns: string, app: string): O => ({ metadata: { namespace: ns, name: app }, spec: { selector: { matchLabels: { app } } } });
const ns = (name: string, labels: Record<string, string> = {}): O => ({ metadata: { name, labels } });

function base(over: Partial<BestPracticesInput> = {}): BestPracticesInput {
  return {
    deployments: [],
    statefulsets: [],
    pdbs: [],
    networkPolicies: [],
    namespaces: [],
    ingressClasses: [],
    apiGroups: [],
    ...over,
  };
}
const get = (i: BestPracticesInput, id: string) => computeBestPractices(i).find((c) => c.id === id)!;

describe("computeBestPractices", () => {
  it("returns the eleven checks in four groups", () => {
    const r = computeBestPractices(base());
    expect(r).toHaveLength(11);
    expect(new Set(r.map((c) => c.group))).toEqual(new Set(["Reliability", "Security", "Disaster recovery", "Platform"]));
  });

  it("pdb: fails for a multi-replica workload with no covering PDB, passes when covered", () => {
    const d = dep("shop", "api", 3, ok);
    const failing = get(base({ deployments: [d] }), "pdb");
    expect(failing.status).toBe("fail");
    expect(failing.offenders).toEqual(["shop/api"]);
    expect(get(base({ deployments: [d], pdbs: [pdb("shop", "api")] }), "pdb").status).toBe("pass");
  });

  it("pdb: ignores single replicas and system namespaces", () => {
    const r = get(base({ deployments: [dep("shop", "one", 1, ok), dep("kube-system", "dns", 2, ok)] }), "pdb");
    expect(r.status).toBe("pass");
  });

  it("pdb: unknown when the deployments or PDBs can't be listed", () => {
    expect(get(base({ deployments: undefined }), "pdb").status).toBe("unknown");
    expect(get(base({ pdbs: undefined }), "pdb").status).toBe("unknown");
  });

  it("requests-limits: fails when a container lacks requests or a memory limit", () => {
    const bad = dep("shop", "bare", 1, {});
    const r = get(base({ deployments: [bad, dep("shop", "good", 1, ok)] }), "requests-limits");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["shop/bare"]);
    expect(get(base({ deployments: [dep("shop", "good", 1, ok)] }), "requests-limits").status).toBe("pass");
  });

  it("probes: fails when a container has no readiness probe", () => {
    const r = get(base({ deployments: [dep("shop", "np", 1, { resources: ok.resources })] }), "probes");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["shop/np"]);
  });

  it("offenders are capped at three but the count is full", () => {
    const many = ["a", "b", "c", "d", "e"].map((n) => dep("shop", n, 1, {}));
    const r = get(base({ deployments: many }), "probes");
    expect(r.offenders).toHaveLength(3);
    expect(r.detail).toContain("5");
  });

  it("network-policies: fails for a namespace with workloads and no policy", () => {
    const d = dep("shop", "api", 1, ok);
    const r = get(base({ deployments: [d], namespaces: [ns("shop")] }), "network-policies");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["shop"]);
    const withPol = get(
      base({ deployments: [d], namespaces: [ns("shop")], networkPolicies: [{ metadata: { namespace: "shop", name: "deny" } }] }),
      "network-policies",
    );
    expect(withPol.status).toBe("pass");
    expect(withPol.link).toBe("/network-policy");
  });

  it("pod-security: needs an enforce label on each non-system namespace", () => {
    expect(get(base({ namespaces: [ns("shop"), ns("kube-system")] }), "pod-security").status).toBe("fail");
    const labelled = ns("shop", { "pod-security.kubernetes.io/enforce": "baseline" });
    expect(get(base({ namespaces: [labelled, ns("kube-system")] }), "pod-security").status).toBe("pass");
  });

  it("tool checks pass with a link when the API group exists, fail with install steps when not", () => {
    const installed = get(base({ apiGroups: ["velero.io"] }), "backups");
    expect(installed.status).toBe("pass");
    expect(installed.link).toBe("/helm");
    expect(installed.install).toBeUndefined();
    const missing = get(base({ apiGroups: ["apps"] }), "backups");
    expect(missing.status).toBe("fail");
    expect(missing.detail).toMatch(/not detected/i);
    expect(missing.install?.commands.join("\n")).toContain("velero");
  });

  it("tool checks are unknown when API discovery is unavailable", () => {
    for (const id of ["backups", "metrics-server", "cert-manager", "policy-engine", "image-scanner"]) {
      expect(get(base({ apiGroups: undefined }), id).status).toBe("unknown");
    }
  });

  it("detects the policy engine from Kyverno or Gatekeeper, the scanner from Trivy-Operator", () => {
    expect(get(base({ apiGroups: ["kyverno.io"] }), "policy-engine").status).toBe("pass");
    expect(get(base({ apiGroups: ["templates.gatekeeper.sh"] }), "policy-engine").status).toBe("pass");
    const s = get(base({ apiGroups: ["aquasecurity.github.io"] }), "image-scanner");
    expect(s.status).toBe("pass");
    expect(s.link).toBe("/vulnerabilities");
    expect(get(base({ apiGroups: ["metrics.k8s.io"] }), "metrics-server").status).toBe("pass");
    expect(get(base({ apiGroups: ["cert-manager.io"] }), "cert-manager").status).toBe("pass");
  });

  it("ingress: passes with an IngressClass, fails without, unknown when unreadable", () => {
    expect(get(base({ ingressClasses: [{ metadata: { name: "nginx" } }] }), "ingress").status).toBe("pass");
    const none = get(base(), "ingress");
    expect(none.status).toBe("fail");
    expect(none.install).toBeDefined();
    expect(get(base({ ingressClasses: undefined }), "ingress").status).toBe("unknown");
  });

  it("never shows a pass for an install command it would run: commands are plain text lines", () => {
    for (const c of computeBestPractices(base())) {
      for (const line of c.install?.commands ?? []) expect(typeof line).toBe("string");
    }
  });
});
