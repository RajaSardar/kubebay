import { describe, it, expect } from "vitest";
import { buildRolloutProgress } from "../rollout";

function deployment(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { uid: "dep-uid-1", name: "my-app", namespace: "default" },
    spec: { replicas: 3 },
    status: { conditions: [] },
    ...overrides,
  };
}

function replicaSet(opts: {
  name: string;
  ownerUid?: string;
  revision?: number;
  ready?: number;
  desired?: number;
}) {
  return {
    metadata: {
      name: opts.name,
      annotations: opts.revision !== undefined ? { "deployment.kubernetes.io/revision": String(opts.revision) } : {},
      ownerReferences: opts.ownerUid ? [{ kind: "Deployment", uid: opts.ownerUid, name: "my-app" }] : [],
    },
    spec: { replicas: opts.desired ?? 0 },
    status: { readyReplicas: opts.ready ?? 0 },
  };
}

describe("buildRolloutProgress", () => {
  it("includes only ReplicaSets owned by this Deployment", () => {
    const rs1 = replicaSet({ name: "rs-mine", ownerUid: "dep-uid-1", revision: 2, ready: 3, desired: 3 });
    const rs2 = replicaSet({ name: "rs-other", ownerUid: "dep-uid-2", revision: 1, ready: 1, desired: 1 });
    const result = buildRolloutProgress(deployment(), [rs1, rs2]);
    expect(result.replicaSets.map((r) => r.name)).toEqual(["rs-mine"]);
  });

  it("marks the highest-revision ReplicaSet as new, others as old", () => {
    const old = replicaSet({ name: "rs-old", ownerUid: "dep-uid-1", revision: 1, ready: 0, desired: 0 });
    const current = replicaSet({ name: "rs-new", ownerUid: "dep-uid-1", revision: 2, ready: 3, desired: 3 });
    const result = buildRolloutProgress(deployment(), [old, current]);
    const byName = Object.fromEntries(result.replicaSets.map((r) => [r.name, r]));
    expect(byName["rs-new"]!.isNew).toBe(true);
    expect(byName["rs-old"]!.isNew).toBe(false);
  });

  it("sorts ReplicaSets newest-revision first", () => {
    const r1 = replicaSet({ name: "rs-1", ownerUid: "dep-uid-1", revision: 1 });
    const r3 = replicaSet({ name: "rs-3", ownerUid: "dep-uid-1", revision: 3 });
    const r2 = replicaSet({ name: "rs-2", ownerUid: "dep-uid-1", revision: 2 });
    const result = buildRolloutProgress(deployment(), [r1, r3, r2]);
    expect(result.replicaSets.map((r) => r.name)).toEqual(["rs-3", "rs-2", "rs-1"]);
  });

  it("extracts the Progressing condition's reason and status", () => {
    const dep = deployment({
      status: { conditions: [{ type: "Progressing", status: "True", reason: "NewReplicaSetAvailable" }] },
    });
    const result = buildRolloutProgress(dep, []);
    expect(result.progressingReason).toBe("NewReplicaSetAvailable");
    expect(result.progressingStatus).toBe("True");
    expect(result.stuck).toBe(false);
  });

  it("flags a stuck rollout on ProgressDeadlineExceeded and carries the condition message", () => {
    const dep = deployment({
      status: { conditions: [{ type: "Progressing", status: "False", reason: "ProgressDeadlineExceeded", message: "timed out" }] },
    });
    const result = buildRolloutProgress(dep, []);
    expect(result.stuck).toBe(true);
    expect(result.progressingMessage).toBe("timed out");
  });

  it("reads desiredReplicas from spec.replicas, defaulting to 0", () => {
    expect(buildRolloutProgress(deployment({ spec: {} }), []).desiredReplicas).toBe(0);
    expect(buildRolloutProgress(deployment({ spec: { replicas: 5 } }), []).desiredReplicas).toBe(5);
  });

  it("handles a Deployment with no owned ReplicaSets yet", () => {
    const result = buildRolloutProgress(deployment(), []);
    expect(result.replicaSets).toEqual([]);
  });
});
