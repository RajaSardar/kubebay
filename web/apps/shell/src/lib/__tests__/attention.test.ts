import { describe, expect, it } from "vitest";
import { findAttention } from "../attention";

// Overview v2, Needs attention: one row per broken workload, its reason in
// plain words with the Kubernetes term kept, ready of desired, and when it
// started. Node trouble shows up as the reason in the row it hurts.

const NOW = Date.parse("2026-10-02T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

type Obj = Record<string, unknown>;

function pod(o: {
  name: string;
  ns?: string;
  owner?: { kind: string; name: string };
  hash?: string;
  phase?: string;
  waiting?: string;
  lastTerminated?: string;
  restarts?: number;
  ready?: boolean;
  node?: string;
  created?: string;
  notReadySince?: string;
  unschedulable?: string;
  reason?: string;
  deleting?: boolean;
}): Obj {
  const cs = {
    name: "app",
    ready: o.ready ?? !o.waiting,
    restartCount: o.restarts ?? 0,
    state: o.waiting ? { waiting: { reason: o.waiting, message: `${o.waiting} msg` } } : { running: {} },
    lastState: o.lastTerminated ? { terminated: { reason: o.lastTerminated } } : {},
  };
  const conditions: Obj[] = [];
  if (o.notReadySince) conditions.push({ type: "Ready", status: "False", lastTransitionTime: o.notReadySince });
  if (o.unschedulable) conditions.push({ type: "PodScheduled", status: "False", reason: "Unschedulable", message: o.unschedulable, lastTransitionTime: o.created ?? ago(10) });
  return {
    metadata: {
      name: o.name,
      namespace: o.ns ?? "shop",
      creationTimestamp: o.created ?? ago(60),
      labels: o.hash ? { "pod-template-hash": o.hash } : {},
      ownerReferences: o.owner ? [{ kind: o.owner.kind, name: o.owner.name, controller: true }] : [],
      ...(o.deleting ? { deletionTimestamp: ago(0) } : {}),
    },
    spec: { containers: [{ name: "app" }], nodeName: o.node ?? "node-1" },
    status: { phase: o.phase ?? "Running", reason: o.reason, conditions, containerStatuses: o.phase === "Pending" && !o.waiting ? [] : [cs] },
  };
}

function deploy(name: string, replicas: number, ready: number, ns = "shop"): Obj {
  return {
    metadata: { name, namespace: ns },
    spec: { replicas, selector: { matchLabels: { app: name } } },
    status: { replicas, readyReplicas: ready, updatedReplicas: replicas },
  };
}

function node(name: string, conds: Record<string, string> = {}): Obj {
  const conditions = [{ type: "Ready", status: conds.Ready ?? "True" }];
  for (const t of ["MemoryPressure", "DiskPressure", "PIDPressure"]) conditions.push({ type: t, status: conds[t] ?? "False" });
  return { metadata: { name }, status: { conditions } };
}

const empty = { deployments: [], statefulSets: [], daemonSets: [], nodes: [node("node-1")], now: NOW };

describe("findAttention", () => {
  it("is empty when every pod is healthy", () => {
    const pods = [pod({ name: "web-abc-1", owner: { kind: "ReplicaSet", name: "web-abc" }, hash: "abc" })];
    expect(findAttention({ ...empty, pods, deployments: [deploy("web", 1, 1)] })).toEqual([]);
  });

  it("groups a Deployment's crashing pods into one row with a plain reason, the code, ready of desired and restarts", () => {
    const pods = [
      pod({ name: "api-7f9-a", owner: { kind: "ReplicaSet", name: "api-7f9" }, hash: "7f9", waiting: "CrashLoopBackOff", restarts: 9, notReadySince: ago(12) }),
      pod({ name: "api-7f9-b", owner: { kind: "ReplicaSet", name: "api-7f9" }, hash: "7f9", waiting: "CrashLoopBackOff", restarts: 5, notReadySince: ago(30) }),
      pod({ name: "api-7f9-c", owner: { kind: "ReplicaSet", name: "api-7f9" }, hash: "7f9" }),
    ];
    const rows = findAttention({ ...empty, pods, deployments: [deploy("api", 3, 1)] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "Deployment",
      namespace: "shop",
      name: "api",
      code: "CrashLoopBackOff",
      plain: "Keeps crashing on start",
      severity: "err",
      ready: 1,
      desired: 3,
      restarts: 14,
      since: NOW - 30 * 60_000,
      pods: ["shop/api-7f9-a", "shop/api-7f9-b"],
    });
  });

  it("names out-of-memory crashes OOMKilled rather than the back-off", () => {
    const pods = [pod({ name: "w-1", owner: { kind: "StatefulSet", name: "w" }, waiting: "CrashLoopBackOff", lastTerminated: "OOMKilled", restarts: 3 })];
    const [row] = findAttention({ ...empty, pods });
    expect(row).toMatchObject({ kind: "StatefulSet", name: "w", code: "OOMKilled", plain: "Runs out of memory" });
  });

  it("explains image pulls, config errors and unschedulable pods in words", () => {
    const pods = [
      pod({ name: "a", waiting: "ImagePullBackOff" }),
      pod({ name: "b", waiting: "CreateContainerConfigError" }),
      pod({ name: "c", phase: "Pending", unschedulable: "0/3 nodes are available: 3 Insufficient memory." }),
    ];
    const byName = Object.fromEntries(findAttention({ ...empty, pods }).map((r) => [r.name, r]));
    expect(byName.a).toMatchObject({ kind: "Pod", code: "ImagePullBackOff", plain: "Can't download its image" });
    expect(byName.b).toMatchObject({ code: "CreateContainerConfigError", plain: "Missing a config map or secret it needs" });
    expect(byName.c).toMatchObject({ code: "Unschedulable", plain: "Can't find room to start", detail: "0/3 nodes are available: 3 Insufficient memory." });
  });

  it("puts node trouble in the row it hurts instead of a node grid", () => {
    const pods = [
      pod({ name: "x", node: "node-2", ready: false, notReadySince: ago(8) }),
      pod({ name: "y", node: "node-3", ready: false, notReadySince: ago(8) }),
    ];
    const nodes = [node("node-1"), node("node-2", { MemoryPressure: "True" }), node("node-3", { Ready: "False" })];
    const byName = Object.fromEntries(findAttention({ ...empty, pods, nodes }).map((r) => [r.name, r]));
    expect(byName.x).toMatchObject({ code: "MemoryPressure", plain: "Its node is short on memory", severity: "warn", node: "node-2" });
    expect(byName.y).toMatchObject({ code: "NodeNotReady", plain: "Its node is down", severity: "err", node: "node-3" });
  });

  it("flags pods stuck starting or running unready for more than 5 minutes, not fresh ones", () => {
    const pods = [
      pod({ name: "slow", phase: "Pending", created: ago(9) }),
      pod({ name: "fresh", phase: "Pending", created: ago(1) }),
      pod({ name: "unready", ready: false, notReadySince: ago(7) }),
      pod({ name: "warming", ready: false, notReadySince: ago(2) }),
    ];
    const names = findAttention({ ...empty, pods }).map((r) => `${r.name}:${r.code}`);
    expect(names.sort()).toEqual(["slow:Pending", "unready:NotReady"]);
  });

  it("skips finished and terminating pods, and says Evicted for evictions", () => {
    const pods = [
      pod({ name: "done", phase: "Succeeded" }),
      pod({ name: "bye", waiting: "CrashLoopBackOff", deleting: true }),
      pod({ name: "ev", phase: "Failed", reason: "Evicted" }),
    ];
    const rows = findAttention({ ...empty, pods });
    expect(rows.map((r) => `${r.name}:${r.code}:${r.plain}`)).toEqual(["ev:Evicted:Was evicted from its node"]);
  });

  it("lists a Deployment short of copies even when no pod exists to blame", () => {
    const d = deploy("quota", 3, 0);
    (d.status as Obj).conditions = [{ type: "Available", status: "False", reason: "MinimumReplicasUnavailable", lastTransitionTime: ago(20) }];
    const [row] = findAttention({ ...empty, pods: [], deployments: [d] });
    expect(row).toMatchObject({ kind: "Deployment", name: "quota", code: "MinimumReplicasUnavailable", plain: "Not enough copies running", ready: 0, desired: 3, pods: [] });
  });

  it("orders failures before warnings, then by how many pods are broken", () => {
    const pods = [
      pod({ name: "warn-1", node: "node-2", ready: false, notReadySince: ago(9) }),
      pod({ name: "one", waiting: "ImagePullBackOff" }),
      pod({ name: "many-x-1", owner: { kind: "DaemonSet", name: "many" }, waiting: "CrashLoopBackOff" }),
      pod({ name: "many-x-2", owner: { kind: "DaemonSet", name: "many" }, waiting: "CrashLoopBackOff" }),
    ];
    const nodes = [node("node-1"), node("node-2", { DiskPressure: "True" })];
    expect(findAttention({ ...empty, pods, nodes }).map((r) => r.name)).toEqual(["many", "one", "warn-1"]);
  });
});
