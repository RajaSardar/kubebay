import { describe, expect, it } from "vitest";
import { rolloutsInProgress } from "../rolloutsInProgress";

// Overview v2: rollouts show only while something is rolling out; a stalled
// one says why.

type Obj = Record<string, unknown>;

function deploy(name: string, o: { desired: number; updated: number; ready: number; replicas?: number; progressing?: string; message?: string; generation?: number; observed?: number; paused?: boolean }): Obj {
  return {
    metadata: { name, namespace: "shop", generation: o.generation ?? 2 },
    spec: { replicas: o.desired, paused: o.paused, selector: { matchLabels: { app: name } } },
    status: {
      observedGeneration: o.observed ?? 2,
      replicas: o.replicas ?? o.desired,
      updatedReplicas: o.updated,
      readyReplicas: o.ready,
      conditions: o.progressing ? [{ type: "Progressing", status: o.progressing === "ProgressDeadlineExceeded" ? "False" : "True", reason: o.progressing, message: o.message ?? "" }] : [],
    },
  };
}

describe("rolloutsInProgress", () => {
  it("lists a Deployment mid-rollout with updated, ready and desired", () => {
    const rows = rolloutsInProgress({
      deployments: [
        deploy("api", { desired: 4, updated: 3, ready: 3, replicas: 5, progressing: "ReplicaSetUpdated" }),
        deploy("done", { desired: 2, updated: 2, ready: 2, progressing: "NewReplicaSetAvailable" }),
      ],
      statefulSets: [],
      daemonSets: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "Deployment", name: "api", namespace: "shop", updated: 3, ready: 3, desired: 4, stalled: false });
  });

  it("marks a rollout past its deadline stalled, with the reason", () => {
    const [row] = rolloutsInProgress({
      deployments: [deploy("pay", { desired: 3, updated: 1, ready: 2, progressing: "ProgressDeadlineExceeded", message: 'ReplicaSet "pay-9c" has timed out progressing.' })],
      statefulSets: [],
      daemonSets: [],
    });
    expect(row).toMatchObject({ stalled: true, reason: 'ReplicaSet "pay-9c" has timed out progressing.' });
  });

  it("counts a spec change the controller hasn't seen yet, and skips paused Deployments", () => {
    const rows = rolloutsInProgress({
      deployments: [
        deploy("fresh", { desired: 2, updated: 2, ready: 2, generation: 3, observed: 2 }),
        deploy("held", { desired: 2, updated: 1, ready: 2, replicas: 3, paused: true, progressing: "ReplicaSetUpdated" }),
      ],
      statefulSets: [],
      daemonSets: [],
    });
    expect(rows.map((r) => r.name)).toEqual(["fresh"]);
  });

  it("follows StatefulSets by revision and DaemonSets by updated nodes", () => {
    const rows = rolloutsInProgress({
      deployments: [],
      statefulSets: [
        { metadata: { name: "db", namespace: "data" }, spec: { replicas: 3 }, status: { currentRevision: "db-1", updateRevision: "db-2", updatedReplicas: 1, readyReplicas: 3 } },
        { metadata: { name: "steady", namespace: "data" }, spec: { replicas: 3 }, status: { currentRevision: "s-2", updateRevision: "s-2", updatedReplicas: 3, readyReplicas: 3 } },
      ],
      daemonSets: [
        { metadata: { name: "agent", namespace: "kube-system" }, spec: {}, status: { desiredNumberScheduled: 5, updatedNumberScheduled: 2, numberReady: 5 } },
        { metadata: { name: "ok", namespace: "kube-system" }, spec: {}, status: { desiredNumberScheduled: 5, updatedNumberScheduled: 5, numberReady: 5 } },
      ],
    });
    expect(rows.map((r) => `${r.kind}/${r.name}:${r.updated}/${r.ready}/${r.desired}`)).toEqual(["StatefulSet/db:1/3/3", "DaemonSet/agent:2/5/5"]);
  });

  it("puts stalled rollouts first", () => {
    const rows = rolloutsInProgress({
      deployments: [
        deploy("a", { desired: 2, updated: 1, ready: 1, replicas: 3, progressing: "ReplicaSetUpdated" }),
        deploy("b", { desired: 2, updated: 1, ready: 1, progressing: "ProgressDeadlineExceeded" }),
      ],
      statefulSets: [],
      daemonSets: [],
    });
    expect(rows.map((r) => r.name)).toEqual(["b", "a"]);
  });
});
