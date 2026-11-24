import { describe, expect, it } from "vitest";
import { workloadPods } from "../workloadPods";

// Backlog 75: a workload's drawer lists its pods, matched by the owner chain.
const pod = (name: string, owner?: { kind: string; name: string; uid: string }, ns = "shop") => ({
  metadata: {
    name,
    namespace: ns,
    creationTimestamp: "2026-01-01T00:00:00Z",
    resourceVersion: "1",
    ...(owner ? { ownerReferences: [{ ...owner, controller: true }] } : {}),
  },
  spec: { nodeName: "n1", containers: [{ name: "c" }] },
  status: { phase: "Running", containerStatuses: [{ name: "c", ready: true, restartCount: 2 }] },
});
const rs = (name: string, depUid: string) => ({
  metadata: { name, namespace: "shop", uid: `uid-${name}`, ownerReferences: [{ kind: "Deployment", name: "web", uid: depUid, controller: true }] },
});

describe("workloadPods", () => {
  it("matches a Deployment's pods through its ReplicaSets, not another Deployment's", () => {
    const dep = { kind: "Deployment", metadata: { name: "web", namespace: "shop", uid: "d1" } };
    const pods = [
      pod("web-a-1", { kind: "ReplicaSet", name: "web-a", uid: "uid-web-a" }),
      pod("web-b-1", { kind: "ReplicaSet", name: "web-b", uid: "uid-web-b" }),
      pod("other-1", { kind: "ReplicaSet", name: "other-a", uid: "uid-other-a" }),
      pod("bare"),
    ];
    const sets = [rs("web-a", "d1"), rs("web-b", "d1"), rs("other-a", "d2")];
    const rows = workloadPods(dep, pods, sets);
    expect(rows.map((r) => r.name)).toEqual(["web-a-1", "web-b-1"]);
    expect(rows[0]).toMatchObject({ ready: "1/1", restarts: 2, node: "n1", namespace: "shop" });
  });

  it("matches StatefulSet, DaemonSet and Job pods by their direct controller uid", () => {
    for (const kind of ["StatefulSet", "DaemonSet", "Job"]) {
      const w = { kind, metadata: { name: "x", namespace: "shop", uid: "u1" } };
      const pods = [pod("x-0", { kind, name: "x", uid: "u1" }), pod("y-0", { kind, name: "y", uid: "u2" })];
      expect(workloadPods(w, pods, []).map((r) => r.name)).toEqual(["x-0"]);
    }
  });

  it("sorts by name and ignores pods in other namespaces", () => {
    const w = { kind: "StatefulSet", metadata: { name: "x", namespace: "shop", uid: "u1" } };
    const o = { kind: "StatefulSet", name: "x", uid: "u1" };
    const rows = workloadPods(w, [pod("x-10", o), pod("x-2", o), pod("x-1", o, "other")], []);
    expect(rows.map((r) => r.name)).toEqual(["x-2", "x-10"]);
  });
});
