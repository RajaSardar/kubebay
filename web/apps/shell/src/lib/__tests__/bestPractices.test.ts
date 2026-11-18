import { describe, expect, it } from "vitest";
import { computeBestPractices, filterChecks, sortChecks, summarize, type BestPracticesInput } from "../bestPractices";

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
  it("returns the original eleven checks plus the new ones, in four groups", () => {
    const r = computeBestPractices(base());
    expect(r).toHaveLength(24);
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

  it("every check has a severity, a why line and a Learn lesson with an official docs link", () => {
    for (const c of computeBestPractices(base())) {
      expect(["Critical", "High", "Medium", "Low"]).toContain(c.severity);
      expect(c.why.length).toBeGreaterThan(10);
      expect(c.learn.text.length).toBeGreaterThan(20);
      expect(c.learn.docsUrl).toMatch(/^https:\/\//);
    }
  });

  it("privileged: flags privileged containers and hostNetwork/hostPath, passes clean ones", () => {
    const priv = dep("shop", "priv", 1, { securityContext: { privileged: true } });
    expect(get(base({ deployments: [priv] }), "privileged").status).toBe("fail");
    expect(get(base({ deployments: [priv] }), "privileged").offenders).toEqual(["shop/priv"]);
    expect(get(base({ deployments: [dep("shop", "ok", 1, ok)] }), "privileged").status).toBe("pass");
    const hn = dep("shop", "hn", 1, ok);
    (hn.spec as O & { template: { spec: O } }).template.spec.hostNetwork = true;
    const hp = dep("shop", "hp", 1, ok);
    (hp.spec as O & { template: { spec: O } }).template.spec.volumes = [{ name: "v", hostPath: { path: "/" } }];
    const r = get(base({ deployments: [hn, hp] }), "host-access");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["shop/hn", "shop/hp"]);
  });

  it("runs-as-root: flags runAsUser 0 or runAsNonRoot false", () => {
    const r = get(base({ deployments: [dep("shop", "root", 1, { securityContext: { runAsUser: 0 } }), dep("shop", "n", 1, { securityContext: { runAsNonRoot: false } }), dep("shop", "ok", 1, { securityContext: { runAsNonRoot: true } })] }), "runs-as-root");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["shop/root", "shop/n"]);
  });

  it("latest-tag: flags :latest and untagged images, not tags or digests", () => {
    const r = get(base({ deployments: [dep("a", "x", 1, { image: "nginx" }), dep("a", "y", 1, { image: "nginx:latest" }), dep("a", "z", 1, { image: "nginx:1.25" }), dep("a", "d", 1, { image: "nginx@sha256:abc" }), dep("a", "r", 1, { image: "reg:5000/app" })] }), "latest-tag");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["a/x", "a/y", "a/r"]);
  });

  it("liveness: flags containers with no liveness probe", () => {
    const r = get(base({ deployments: [dep("a", "x", 1, {}), dep("a", "y", 1, { livenessProbe: {} })] }), "liveness");
    expect(r.offenders).toEqual(["a/x"]);
  });

  it("lb-source-ranges: flags LoadBalancer Services with no source ranges", () => {
    const lb = (name: string, ranges?: string[]): O => ({ metadata: { namespace: "a", name }, spec: { type: "LoadBalancer", loadBalancerSourceRanges: ranges } });
    const r = get(base({ services: [lb("open"), lb("closed", ["10.0.0.0/8"]), { metadata: { namespace: "a", name: "cip" }, spec: { type: "ClusterIP" } }] }), "lb-source-ranges");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["a/open"]);
    expect(get(base({ services: undefined }), "lb-source-ranges").status).toBe("unknown");
  });

  it("sa-automount: flags workloads on the default ServiceAccount with the token mounted", () => {
    const d = dep("a", "dflt", 1, ok);
    const own = dep("a", "own", 1, ok);
    (own.spec as { template: { spec: O } }).template.spec.serviceAccountName = "app";
    const off = dep("a", "off", 1, ok);
    (off.spec as { template: { spec: O } }).template.spec.automountServiceAccountToken = false;
    const r = get(base({ deployments: [d, own, off] }), "sa-automount");
    expect(r.offenders).toEqual(["a/dflt"]);
  });

  it("secrets-in-env: flags plain-text values on sensitive names, not secretKeyRef", () => {
    const withEnv = (env: O[]) => dep("a", "w" + env.length + String(env[0]?.name), 1, { env });
    const r = get(base({ deployments: [withEnv([{ name: "DB_PASSWORD", value: "x" }]), withEnv([{ name: "DB_PASSWORD", valueFrom: { secretKeyRef: { name: "s", key: "k" } } }]), withEnv([{ name: "LOG_LEVEL", value: "debug" }])] }), "secrets-in-env");
    expect(r.status).toBe("fail");
    expect(r.offenders).toHaveLength(1);
  });

  it("pvc-backup: needs a Velero schedule when PVCs exist; no PVCs passes", () => {
    const pvc: O = { metadata: { namespace: "a", name: "data" } };
    expect(get(base({ pvcs: [pvc], veleroSchedules: [] }), "pvc-backup").status).toBe("fail");
    expect(get(base({ pvcs: [pvc], veleroSchedules: [{ metadata: { name: "daily" } }] }), "pvc-backup").status).toBe("pass");
    expect(get(base({ pvcs: [], veleroSchedules: [] }), "pvc-backup").status).toBe("pass");
    expect(get(base({ pvcs: [pvc], veleroSchedules: undefined }), "pvc-backup").status).toBe("unknown");
    expect(get(base({ pvcs: undefined, veleroSchedules: [] }), "pvc-backup").status).toBe("unknown");
  });

  const node = (name: string, ready: string, version: string): O => ({
    metadata: { name },
    status: { conditions: [{ type: "Ready", status: ready }], nodeInfo: { kubeletVersion: version } },
  });

  it("nodes-ready: fails on a NotReady node", () => {
    const r = get(base({ nodes: [node("n1", "True", "v1.29.1"), node("n2", "False", "v1.29.1")] }), "nodes-ready");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["n2"]);
    expect(get(base({ nodes: [node("n1", "True", "v1.29.1")] }), "nodes-ready").status).toBe("pass");
    expect(get(base({ nodes: undefined }), "nodes-ready").status).toBe("unknown");
  });

  it("node-version-skew: fails when minor versions differ, passes on patch differences", () => {
    expect(get(base({ nodes: [node("a", "True", "v1.29.1"), node("b", "True", "v1.30.2")] }), "node-version-skew").status).toBe("fail");
    expect(get(base({ nodes: [node("a", "True", "v1.29.1"), node("b", "True", "v1.29.5")] }), "node-version-skew").status).toBe("pass");
  });

  it("cert-expiry: fails for a certificate expiring within 14 days or not Ready", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const cert = (name: string, notAfter: string, ready = "True"): O => ({
      metadata: { namespace: "a", name },
      status: { notAfter, conditions: [{ type: "Ready", status: ready }] },
    });
    const r = get(
      base({ now, certificates: [cert("soon", "2026-01-05T00:00:00Z"), cert("far", "2026-06-01T00:00:00Z"), cert("bad", "2026-06-01T00:00:00Z", "False")] }),
      "cert-expiry",
    );
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["a/soon", "a/bad"]);
    expect(get(base({ now, certificates: [] }), "cert-expiry").status).toBe("pass");
    expect(get(base({ now, certificates: undefined }), "cert-expiry").status).toBe("unknown");
  });

  it("hpa-max: flags an HPA running at its maximum", () => {
    const hpa = (name: string, cur: number, max: number): O => ({ metadata: { namespace: "a", name }, spec: { maxReplicas: max }, status: { currentReplicas: cur } });
    const r = get(base({ hpas: [hpa("pegged", 5, 5), hpa("room", 2, 5)] }), "hpa-max");
    expect(r.status).toBe("fail");
    expect(r.offenders).toEqual(["a/pegged"]);
  });

  it("new workload checks are unknown when workloads can't be read", () => {
    for (const id of ["privileged", "host-access", "runs-as-root", "latest-tag", "liveness", "sa-automount", "secrets-in-env"]) {
      expect(get(base({ deployments: undefined }), id).status).toBe("unknown");
    }
  });

  it("summarize counts unknown separately and never as a pass", () => {
    const s = summarize(computeBestPractices(base({ deployments: undefined })));
    expect(s.pass + s.fail + s.unknown).toBe(s.total);
    expect(s.unknown).toBeGreaterThan(0);
    expect(s.score).toBe(Math.round((s.pass / s.total) * 100));
    expect(Object.values(s.failedBySeverity).reduce((a, b) => a + b, 0)).toBe(s.fail);
  });

  it("sortChecks orders by severity then filterChecks narrows by severity and status", () => {
    const checks = computeBestPractices(base());
    const sorted = sortChecks(checks, "severity");
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as const;
    for (let i = 1; i < sorted.length; i++) expect(rank[sorted[i - 1]!.severity]).toBeLessThanOrEqual(rank[sorted[i]!.severity]);
    expect(filterChecks(checks, { severity: "Critical", status: "all" }).every((c) => c.severity === "Critical")).toBe(true);
    expect(filterChecks(checks, { severity: "all", status: "unknown" }).every((c) => c.status === "unknown")).toBe(true);
    const byStatus = sortChecks(checks, "status");
    expect(byStatus[0]!.status).toBe("fail");
  });
});
