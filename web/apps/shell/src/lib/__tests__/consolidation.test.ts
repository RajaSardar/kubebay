import { describe, it, expect } from "vitest";
import { assessConsolidation } from "../consolidation";

type Obj = Record<string, unknown>;

function node(name: string, cpu = "4", mem = "16Gi", extra: { labels?: Record<string, string>; taints?: Obj[]; unschedulable?: boolean; ready?: boolean } = {}): Obj {
  return {
    metadata: { name, labels: { "kubernetes.io/hostname": name, ...(extra.labels ?? {}) } },
    spec: { unschedulable: extra.unschedulable, taints: extra.taints },
    status: {
      allocatable: { cpu, memory: mem },
      conditions: [{ type: "Ready", status: extra.ready === false ? "False" : "True" }],
    },
  };
}

function pod(name: string, nodeName: string, cpu: string, mem: string, extra: { ns?: string; owner?: string | null; labels?: Record<string, string>; spec?: Obj; phase?: string; annotations?: Record<string, string> } = {}): Obj {
  const owner = extra.owner === undefined ? "ReplicaSet" : extra.owner;
  return {
    metadata: {
      name,
      namespace: extra.ns ?? "default",
      labels: extra.labels ?? { app: name },
      annotations: extra.annotations,
      ownerReferences: owner ? [{ kind: owner, name: `${name}-owner`, controller: true }] : undefined,
    },
    spec: { nodeName, containers: [{ name: "c", resources: { requests: { cpu, memory: mem } } }], ...(extra.spec ?? {}) },
    status: { phase: extra.phase ?? "Running" },
  };
}

function deployment(name: string, replicas: number, labels: Record<string, string>, ns = "default"): Obj {
  return { metadata: { name, namespace: ns }, spec: { replicas, selector: { matchLabels: labels }, template: { metadata: { labels } } } };
}

function pdb(name: string, labels: Record<string, string>, disruptionsAllowed: number, ns = "default"): Obj {
  return { metadata: { name, namespace: ns }, spec: { selector: { matchLabels: labels } }, status: { disruptionsAllowed } };
}

const empty = { pdbs: [], deployments: [], statefulSets: [] };
const byNode = (r: ReturnType<typeof assessConsolidation>, n: string) => r.nodes.find((x) => x.node === n)!;

describe("assessConsolidation", () => {
  it("marks a lightly used node drainable when its pods fit on the others by requests", () => {
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b", "8", "32Gi")],
      pods: [pod("web", "a", "500m", "1Gi"), pod("api", "b", "6", "8Gi")],
    });
    expect(byNode(r, "a").outcome).toBe("drainable");
    expect(byNode(r, "a").podsToMove).toBe(1);
    expect(byNode(r, "b").outcome).toBe("blocked");
    expect(byNode(r, "b").blockers).toEqual([{ kind: "no-room", ns: "default", pod: "api" }]);
  });

  it("counts requests of pods already on the target, including DaemonSet pods", () => {
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b")],
      pods: [pod("web", "a", "1", "1Gi"), pod("big", "b", "2500m", "1Gi"), pod("ds-b", "b", "600m", "1Gi", { owner: "DaemonSet" })],
    });
    // b has 4000 - 3100 = 900m free; web needs 1000m.
    expect(byNode(r, "a").outcome).toBe("blocked");
  });

  it("does not move DaemonSet, mirror, or finished pods", () => {
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b")],
      pods: [
        pod("ds", "a", "3", "1Gi", { owner: "DaemonSet" }),
        pod("static", "a", "3", "1Gi", { owner: "Node", annotations: { "kubernetes.io/config.mirror": "x" } }),
        pod("job", "a", "3", "1Gi", { owner: "Job", phase: "Succeeded" }),
      ],
    });
    expect(byNode(r, "a").outcome).toBe("drainable");
    expect(byNode(r, "a").podsToMove).toBe(0);
  });

  it("blocks on a pod with no controller, since draining deletes it for good", () => {
    const r = assessConsolidation({ ...empty, nodes: [node("a"), node("b")], pods: [pod("bare", "a", "100m", "100Mi", { owner: null })] });
    expect(byNode(r, "a").blockers).toEqual([{ kind: "bare-pod", ns: "default", pod: "bare" }]);
  });

  it("blocks on a PDB that allows no disruptions", () => {
    const r = assessConsolidation({
      ...empty,
      pdbs: [pdb("db-pdb", { app: "db" }, 0)],
      nodes: [node("a"), node("b")],
      pods: [pod("db-0", "a", "100m", "100Mi", { owner: "StatefulSet", labels: { app: "db" } })],
    });
    expect(byNode(r, "a").blockers).toEqual([{ kind: "pdb", ns: "default", pod: "db-0", pdb: "db-pdb" }]);
  });

  it("respects nodeSelector, required node affinity and taints when placing pods", () => {
    const tainted = node("c", "8", "32Gi", { taints: [{ key: "gpu", value: "true", effect: "NoSchedule" }] });
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b", "4", "16Gi", { labels: { zone: "z1" } }), tainted],
      pods: [
        pod("sel", "a", "100m", "100Mi", { spec: { nodeSelector: { zone: "z2" } } }),
        pod("aff", "a", "100m", "100Mi", {
          spec: { affinity: { nodeAffinity: { requiredDuringSchedulingIgnoredDuringExecution: { nodeSelectorTerms: [{ matchExpressions: [{ key: "zone", operator: "In", values: ["z1"] }] }] } } } },
        }),
      ],
    });
    // "sel" wants zone=z2: b is z1, c is tainted and "sel" doesn't tolerate it.
    expect(byNode(r, "a").blockers).toEqual([{ kind: "no-room", ns: "default", pod: "sel" }]);
  });

  it("lets a pod that tolerates a taint land on that node", () => {
    const tainted = node("b", "4", "16Gi", { taints: [{ key: "gpu", value: "true", effect: "NoSchedule" }] });
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), tainted],
      pods: [pod("t", "a", "100m", "100Mi", { spec: { tolerations: [{ key: "gpu", operator: "Exists" }] } })],
    });
    expect(byNode(r, "a").outcome).toBe("drainable");
  });

  it("treats required pod anti-affinity as a constraint it doesn't simulate", () => {
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b")],
      pods: [pod("anti", "a", "100m", "100Mi", { spec: { affinity: { podAntiAffinity: { requiredDuringSchedulingIgnoredDuringExecution: [{}] } } } })],
    });
    expect(byNode(r, "a").blockers).toEqual([{ kind: "constrained", ns: "default", pod: "anti" }]);
  });

  it("gates on SPOF Radar: a single-replica workload with no PDB makes the drain cause downtime", () => {
    const r = assessConsolidation({
      ...empty,
      deployments: [deployment("solo", 1, { app: "solo" })],
      nodes: [node("a"), node("b")],
      pods: [pod("solo-x", "a", "100m", "100Mi", { labels: { app: "solo" } })],
    });
    expect(byNode(r, "a").outcome).toBe("downtime");
    expect(byNode(r, "a").spof).toEqual([{ ns: "default", name: "solo", workloadKind: "Deployment" }]);
    expect(r.drainable).not.toContain("a");
  });

  it("skips control-plane, NotReady and already-cordoned nodes as drain candidates", () => {
    const r = assessConsolidation({
      ...empty,
      nodes: [
        node("a"),
        node("cp", "8", "32Gi", {
          labels: { "node-role.kubernetes.io/control-plane": "" },
          taints: [{ key: "node-role.kubernetes.io/control-plane", effect: "NoSchedule" }],
        }),
        node("down", "8", "32Gi", { ready: false }),
        node("cordoned", "8", "32Gi", { unschedulable: true }),
      ],
      pods: [pod("web", "a", "100m", "100Mi")],
    });
    expect(byNode(r, "cp").outcome).toBe("skipped");
    expect(byNode(r, "down").skipReason).toBe("not Ready");
    expect(byNode(r, "cordoned").skipReason).toBe("already cordoned");
    // The tainted control plane, the NotReady node and the cordoned node can't receive pods.
    expect(byNode(r, "a").outcome).toBe("blocked");
  });

  it("drains nodes one after another, so two nodes aren't both counted against the same free space", () => {
    // Free: a 1.5, b 1.5, c 3 cores. On its own each node fits elsewhere,
    // but once c's pod lands on a, neither a nor b has room for the other's 2.5 cores.
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b"), node("c")],
      pods: [pod("pa", "a", "2500m", "1Gi"), pod("pb", "b", "2500m", "1Gi"), pod("pc", "c", "1", "1Gi")],
    });
    expect(r.nodes.filter((n) => n.outcome === "drainable").map((n) => n.node).sort()).toEqual(["a", "b", "c"]);
    expect(r.drainable).toEqual(["c"]);
  });

  it("finds a multi-node sequence when there is room for it", () => {
    const r = assessConsolidation({
      ...empty,
      nodes: [node("a"), node("b"), node("c")],
      pods: [pod("pa", "a", "500m", "1Gi"), pod("pb", "b", "500m", "1Gi"), pod("pc", "c", "500m", "1Gi")],
    });
    expect(r.drainable).toHaveLength(2);
  });
});
