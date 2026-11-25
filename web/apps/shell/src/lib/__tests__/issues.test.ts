import { describe, expect, it } from "vitest";
import { computeIssues, detectors, filterIssues, issueTarget, rankIssues, type Issue, type IssueInputs } from "../issues";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
type Obj = Record<string, unknown>;

function pod(o: { name: string; ns?: string; owner?: { kind: string; name: string }; waiting?: string; restarts?: number; ready?: boolean; node?: string }): Obj {
  return {
    metadata: {
      name: o.name,
      namespace: o.ns ?? "shop",
      creationTimestamp: ago(60),
      labels: { app: "web" },
      ownerReferences: o.owner ? [{ kind: o.owner.kind, name: o.owner.name, controller: true }] : [],
    },
    spec: { containers: [{ name: "app" }], nodeName: o.node ?? "node-1" },
    status: {
      phase: "Running",
      conditions: [],
      containerStatuses: [
        {
          name: "app",
          ready: o.ready ?? !o.waiting,
          restartCount: o.restarts ?? 0,
          state: o.waiting ? { waiting: { reason: o.waiting, message: `${o.waiting} msg` } } : { running: {} },
        },
      ],
    },
  };
}
const deploy = (name: string, replicas: number, ready: number): Obj => ({
  metadata: { name, namespace: "shop" },
  spec: { replicas, selector: { matchLabels: { app: name } } },
  status: { replicas, readyReplicas: ready },
});
const node = (name: string, conds: Record<string, string> = {}, since = ago(30)): Obj => ({
  metadata: { name },
  status: {
    conditions: [
      { type: "Ready", status: conds.Ready ?? "True", reason: conds.Ready === "False" ? "KubeletNotReady" : "KubeletReady", lastTransitionTime: since },
      ...["MemoryPressure", "DiskPressure", "PIDPressure"].map((t) => ({ type: t, status: conds[t] ?? "False", lastTransitionTime: since })),
    ],
  },
});
const svc = (name: string, selector: Record<string, string> = { app: "web" }): Obj => ({
  metadata: { name, namespace: "shop" },
  spec: { selector, type: "ClusterIP" },
});
const slice = (name: string, ready: boolean): Obj => ({
  metadata: { name: `${name}-x`, namespace: "shop", labels: { "kubernetes.io/service-name": name } },
  endpoints: [{ addresses: ["10.0.0.1"], conditions: { ready } }],
});
const cert = (name: string, notAfter: string, ready = true): Obj => ({
  metadata: { name, namespace: "shop" },
  status: { notAfter, conditions: [{ type: "Ready", status: ready ? "True" : "False", lastTransitionTime: ago(90) }] },
});

const base: IssueInputs = {
  pods: [],
  deployments: [],
  statefulsets: [],
  daemonsets: [],
  nodes: [node("node-1")],
  services: [],
  endpointSlices: [],
  certificates: [],
  now: NOW,
};

describe("pod-problem detector", () => {
  const crashing = [
    pod({ name: "web-1", owner: { kind: "ReplicaSet", name: "web-abc" }, waiting: "CrashLoopBackOff", restarts: 9 }),
    pod({ name: "web-2", owner: { kind: "ReplicaSet", name: "web-abc" }, waiting: "CrashLoopBackOff", restarts: 2 }),
  ].map((p) => ({ ...p, metadata: { ...(p.metadata as Obj), labels: { "pod-template-hash": "abc" } } }));

  it("raises one issue per workload, investigating the worst pod", () => {
    const r = computeIssues("c1", { ...base, pods: crashing, deployments: [deploy("web", 2, 1)] });
    const i = r.issues.find((x) => x.detector === "pod-problem")!;
    expect(i).toMatchObject({
      cluster: "c1",
      kind: "Deployment",
      namespace: "shop",
      name: "web",
      code: "CrashLoopBackOff",
      severity: "high",
      blast: 2,
      id: "pod-problem|Deployment|shop|web|CrashLoopBackOff",
    });
    expect(i.evidence).toEqual({ open: "object", slug: "pods", ns: "shop", name: "web-1" });
    expect(i.summary).toContain("Keeps crashing on start");
    expect(typeof i.since).toBe("number");
    expect(issueTarget(i)).toBe("/workloads?pod=shop%2Fweb-1");
  });

  it("is critical when the whole workload has zero ready", () => {
    const r = computeIssues("c1", { ...base, pods: crashing, deployments: [deploy("web", 2, 0)] });
    expect(r.issues.find((x) => x.detector === "pod-problem")!.severity).toBe("critical");
  });

  it("warnings are medium", () => {
    const p = pod({ name: "w-1", owner: { kind: "ReplicaSet", name: "w-abc" }, waiting: "Pending" });
    const evicted = { ...p, status: { phase: "Failed", reason: "Evicted", message: "m" } };
    const r = computeIssues("c1", { ...base, pods: [evicted] });
    expect(r.issues.find((x) => x.detector === "pod-problem")!.severity).toBe("medium");
  });

  it("a deployment short of copies with no pod to blame opens the deployment", () => {
    const d = { ...deploy("api", 3, 1), status: { readyReplicas: 1, conditions: [{ type: "Available", status: "False", message: "short", lastTransitionTime: ago(20) }] } };
    const i = computeIssues("c1", { ...base, deployments: [d] }).issues.find((x) => x.detector === "pod-problem")!;
    expect(i.evidence).toEqual({ open: "object", slug: "deployments", ns: "shop", name: "api" });
    expect(issueTarget(i)).toBe("/detail/deployments/shop/api");
  });
});

describe("node-condition detector", () => {
  it("NotReady is critical and cluster scoped", () => {
    const r = computeIssues("c1", { ...base, nodes: [node("n1", { Ready: "False" })] });
    const i = r.issues.find((x) => x.detector === "node-condition")!;
    expect(i).toMatchObject({ kind: "Node", namespace: "", name: "n1", code: "NodeNotReady", severity: "critical", id: "node-condition|Node||n1|NodeNotReady" });
    expect(i.since).toBe(Date.parse(ago(30)));
    expect(issueTarget(i)).toBe("/detail/nodes/_/n1");
  });
  it("pressure conditions are medium, one issue per condition", () => {
    const r = computeIssues("c1", { ...base, nodes: [node("n1", { MemoryPressure: "True", DiskPressure: "True" })] });
    const nodes = r.issues.filter((x) => x.detector === "node-condition");
    expect(nodes.map((n) => n.code).sort()).toEqual(["DiskPressure", "MemoryPressure"]);
    expect(nodes.every((n) => n.severity === "medium")).toBe(true);
  });
  it("a healthy node raises nothing, and a node with no conditions is not invented as down", () => {
    expect(detectors["node-condition"]("c1", { ...base, nodes: [node("ok"), { metadata: { name: "bare" } }] }, NOW)).toEqual([]);
  });
});

describe("service-no-ready detector", () => {
  it("zero ready endpoints is high", () => {
    const r = computeIssues("c1", { ...base, services: [svc("web")], pods: [pod({ name: "p" })], endpointSlices: [slice("web", false)] });
    const i = r.issues.find((x) => x.detector === "service-no-ready")!;
    expect(i).toMatchObject({ kind: "Service", name: "web", code: "zero-ready-endpoints", severity: "high" });
    expect(i.evidence).toEqual({ open: "object", slug: "services", ns: "shop", name: "web" });
  });
  it("a selector matching no pods is medium", () => {
    const r = computeIssues("c1", { ...base, services: [svc("web", { app: "nope" })] });
    expect(r.issues.find((x) => x.detector === "service-no-ready")).toMatchObject({ code: "no-matching-pods", severity: "medium" });
  });
});

describe("cert-expiry detector", () => {
  it("expired is critical, not-ready and expiring are high, fine raises nothing", () => {
    const certificates = [
      cert("old", new Date(NOW - 86_400_000).toISOString()),
      cert("broken", new Date(NOW + 90 * 86_400_000).toISOString(), false),
      cert("soon", new Date(NOW + 3 * 86_400_000).toISOString()),
      cert("fine", new Date(NOW + 90 * 86_400_000).toISOString()),
    ];
    const issues = computeIssues("c1", { ...base, certificates }).issues.filter((x) => x.detector === "cert-expiry");
    const by = Object.fromEntries(issues.map((i) => [i.name, i]));
    expect(by.old).toMatchObject({ severity: "critical", code: "CertificateExpired" });
    expect(by.broken).toMatchObject({ severity: "high", code: "CertificateNotReady" });
    expect(by.soon).toMatchObject({ severity: "high", code: "CertificateExpiring" });
    expect(by.fine).toBeUndefined();
    expect(by.old!.evidence).toEqual({ open: "object", slug: "cert-manager.io--v1--certificates", ns: "shop", name: "old" });
  });
});

describe("not checked versus clean", () => {
  it("an unsynced or forbidden source is reported, never treated as clean", () => {
    const r = computeIssues("c1", { ...base, pods: "loading", certificates: "not-served", services: "forbidden" });
    const reasons = Object.fromEntries(r.notChecked.map((n) => [n.detector, n.reason]));
    expect(reasons["pod-problem"]).toBe("loading");
    expect(reasons["cert-expiry"]).toBe("not-served");
    expect(reasons["service-no-ready"]).toBe("forbidden");
    expect(reasons["node-condition"]).toBeUndefined();
  });
  it("a missing source counts as loading", () => {
    const r = computeIssues("c1", { now: NOW });
    expect(r.notChecked.find((n) => n.detector === "node-condition")!.reason).toBe("loading");
    expect(r.issues).toEqual([]);
  });
  it("a genuinely clean cluster has no issues and nothing unchecked among the slice-1 detectors", () => {
    const r = computeIssues("c1", base);
    expect(r.issues).toEqual([]);
    expect(r.notChecked.filter((n) => ["pod-problem", "node-condition", "service-no-ready", "cert-expiry"].includes(n.detector))).toEqual([]);
  });
  it("a detector that throws is isolated and reported not checked", () => {
    const bad = { ...base, nodes: [{ metadata: { name: "n" }, status: { conditions: 5 } }] };
    const r = computeIssues("c1", { ...bad, services: [svc("web")], pods: [pod({ name: "p" })], endpointSlices: [slice("web", false)] }, {
      "node-condition": () => {
        throw new Error("boom");
      },
    });
    expect(r.notChecked.find((n) => n.detector === "node-condition")!.reason).toBe("error");
    expect(r.issues.some((i) => i.detector === "service-no-ready")).toBe(true);
  });
});

function mk(over: Partial<Issue>): Issue {
  return {
    id: "x",
    cluster: "c",
    detector: "pod-problem",
    code: "X",
    severity: "high",
    kind: "Deployment",
    namespace: "a",
    name: "n",
    summary: "s",
    blast: 1,
    evidence: { open: "route", path: "/workloads" },
    ...over,
  };
}

describe("rankIssues", () => {
  it("orders by severity, then tier, then blast, then age (oldest first, missing last), then id", () => {
    const list = [
      mk({ id: "g", severity: "low" }),
      mk({ id: "f", severity: "high", detector: "spof" }),
      mk({ id: "e", severity: "high", blast: 1, since: undefined }),
      mk({ id: "d", severity: "high", blast: 1, since: 200 }),
      mk({ id: "c", severity: "high", blast: 1, since: 100 }),
      mk({ id: "b", severity: "high", blast: 5, since: 999 }),
      mk({ id: "a", severity: "critical", detector: "netpol-gap" }),
    ];
    expect(rankIssues(list).map((i) => i.id)).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
  it("does not mutate its input and is stable on equal keys by id", () => {
    const list = [mk({ id: "z" }), mk({ id: "y" })];
    const out = rankIssues(list);
    expect(list.map((i) => i.id)).toEqual(["z", "y"]);
    expect(out.map((i) => i.id)).toEqual(["y", "z"]);
  });
});

describe("filterIssues", () => {
  const list = [
    mk({ id: "1", severity: "critical", kind: "Node", namespace: "" }),
    mk({ id: "2", severity: "high", kind: "Deployment", namespace: "shop" }),
    mk({ id: "3", severity: "medium", kind: "Service", namespace: "shop" }),
  ];
  it("returns everything with no or empty filters", () => {
    expect(filterIssues(list, {})).toHaveLength(3);
    expect(filterIssues(list, { severity: [], kind: [], namespace: [] })).toHaveLength(3);
  });
  it("filters by each field and combines them", () => {
    expect(filterIssues(list, { severity: ["critical", "high"] }).map((i) => i.id)).toEqual(["1", "2"]);
    expect(filterIssues(list, { kind: ["Service"] }).map((i) => i.id)).toEqual(["3"]);
    expect(filterIssues(list, { namespace: ["shop"] }).map((i) => i.id)).toEqual(["2", "3"]);
    expect(filterIssues(list, { namespace: ["shop"], severity: ["medium"] }).map((i) => i.id)).toEqual(["3"]);
    expect(filterIssues(list, { namespace: ["nope"] })).toEqual([]);
  });
});

describe("issueTarget", () => {
  it("route targets carry the path and optional search", () => {
    expect(issueTarget(mk({ evidence: { open: "route", path: "/best-practices" } }))).toBe("/best-practices");
    expect(issueTarget(mk({ evidence: { open: "route", path: "/r/x", search: "?a=1" } }))).toBe("/r/x?a=1");
  });
});

describe("counts and provenance", () => {
  it("counts per severity and every issue names its detector", () => {
    const r = computeIssues("c1", {
      ...base,
      nodes: [node("n1", { Ready: "False" })],
      certificates: [cert("soon", new Date(NOW + 86_400_000).toISOString())],
    });
    expect(r.counts).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
    for (const i of r.issues) expect(i.detector).toBeTruthy();
  });
  it("passes names through verbatim (text only)", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const r = computeIssues("c1", { ...base, certificates: [{ ...cert("x", new Date(NOW - 1000).toISOString()), metadata: { name: evil, namespace: "shop" } }] });
    expect(r.issues[0]!.name).toBe(evil);
  });
});

// ---- Slice 2: latent risk ----

const emptyBp = { deployments: [], statefulsets: [], pdbs: [], networkPolicies: [], namespaces: [], ingressClasses: [], apiGroups: [] as string[] };
const privDep = (ns = "shop", name = "priv"): Obj => ({
  metadata: { namespace: ns, name },
  spec: { replicas: 1, template: { metadata: { labels: { app: name } }, spec: { containers: [{ name: "c", image: "nginx:1.25", securityContext: { privileged: true } }] } } },
});

describe("spof detector", () => {
  it("a single replica with no PDB is medium and opens the workload", () => {
    const d = { ...deploy("solo", 1, 1), spec: { replicas: 1, selector: { matchLabels: { app: "solo" } }, template: { metadata: { labels: { app: "solo" } } } } };
    const r = computeIssues("c1", { ...base, deployments: [d], pdbs: [], pods: [] });
    const i = r.issues.find((x) => x.detector === "spof")!;
    expect(i).toMatchObject({ kind: "Deployment", name: "solo", code: "no-pdb", severity: "medium" });
    expect(i.evidence).toEqual({ open: "object", slug: "deployments", ns: "shop", name: "solo" });
    expect(i.summary).toContain("solo");
  });
});

describe("netpol-gap detector", () => {
  const p = pod({ name: "a" });
  it("no policy in the namespace is medium and points at the Network policy page", () => {
    const r = computeIssues("c1", { ...base, pods: [p, pod({ name: "b" })], networkPolicies: [] });
    const i = r.issues.find((x) => x.detector === "netpol-gap")!;
    expect(i).toMatchObject({ namespace: "shop", code: "no-policy-in-namespace", severity: "medium", blast: 1 });
    expect(i.summary).toContain("2 pods");
    expect(i.evidence).toEqual({ open: "route", path: "/network-policy" });
  });
  it("a namespace with policies that skip the pods is low", () => {
    const np = { metadata: { namespace: "shop", name: "np" }, spec: { podSelector: { matchLabels: { app: "other" } } } };
    const r = computeIssues("c1", { ...base, pods: [p], networkPolicies: [np] });
    expect(r.issues.find((x) => x.detector === "netpol-gap")).toMatchObject({ code: "not-selected-by-any-policy", severity: "low" });
  });
});

describe("best-practice detector", () => {
  it("raises only failing Critical checks, never cert-expiry, and one issue per check", () => {
    const r = computeIssues("c1", { ...base, bestPractices: { ...emptyBp, deployments: [privDep()] } });
    const bp = r.issues.filter((x) => x.detector === "best-practice");
    expect(bp.length).toBeGreaterThan(0);
    expect(bp.every((i) => i.severity === "critical")).toBe(true);
    expect(bp.some((i) => i.code === "cert-expiry")).toBe(false);
    expect(bp[0]!.evidence).toEqual({ open: "route", path: "/best-practices" });
    expect(new Set(bp.map((i) => i.id)).size).toBe(bp.length);
  });
  it("honours waivers", () => {
    const first = computeIssues("c1", { ...base, bestPractices: { ...emptyBp, deployments: [privDep()] } }).issues.find((x) => x.detector === "best-practice")!;
    const waived = computeIssues("c1", {
      ...base,
      bestPractices: { ...emptyBp, deployments: [privDep()] },
      exceptions: [{ checkId: first.code, namespace: "shop", reason: "ok", createdAt: 0 }],
    });
    expect(waived.issues.find((x) => x.id === first.id)).toBeUndefined();
    const whole = computeIssues("c1", { ...base, bestPractices: { ...emptyBp, deployments: [privDep()] }, exceptions: [{ checkId: first.code, reason: "ok", createdAt: 0 }] });
    expect(whole.issues.find((x) => x.id === first.id)).toBeUndefined();
  });
});

describe("upgrade-readiness detector", () => {
  it("a removal within one minor (or past) is high, two away is medium", () => {
    const r = computeIssues("c1", { ...base, upgrade: { serverVersion: "v1.27.3", served: ["policy/v1beta1", "flowcontrol.apiserver.k8s.io/v1beta1"] } });
    const up = Object.fromEntries(r.issues.filter((x) => x.detector === "upgrade-readiness").map((i) => [i.name, i]));
    expect(up["PodDisruptionBudget policy/v1beta1"]).toMatchObject({ severity: "high", kind: "API", namespace: "" });
    expect(up["PodDisruptionBudget policy/v1beta1"]!.summary).toContain("policy/v1");
    expect(up["FlowSchema flowcontrol.apiserver.k8s.io/v1beta1"]!.severity).toBe("medium");
    expect(up["PodDisruptionBudget policy/v1beta1"]!.evidence).toEqual({ open: "route", path: "/upgrade-readiness" });
  });
  it("is not checked until the version and the served APIs are known", () => {
    const r = computeIssues("c1", { ...base, upgrade: { serverVersion: "v1.24.3" } });
    expect(r.notChecked.find((n) => n.detector === "upgrade-readiness")!.reason).toBe("loading");
  });
});

describe("slice 2 sources", () => {
  it("every detector is not checked, not clean, when its sources are missing", () => {
    const r = computeIssues("c1", { now: NOW });
    expect(r.notChecked.map((n) => n.detector).sort()).toEqual(
      ["best-practice", "cert-expiry", "netpol-gap", "node-condition", "pod-problem", "service-no-ready", "spof", "upgrade-readiness"],
    );
  });
});
