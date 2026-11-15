import { describe, it, expect } from "vitest";
import { buildTimeline } from "../resourceTimeline";

type Obj = Record<string, unknown>;

const deploy: Obj = {
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop", uid: "d-1" },
  status: {
    conditions: [
      { type: "Available", status: "True", reason: "MinimumReplicasAvailable", lastTransitionTime: "2026-09-30T10:05:00Z" },
      { type: "Progressing", status: "True", reason: "NewReplicaSetAvailable", message: "ReplicaSet web-2 has successfully progressed.", lastTransitionTime: "2026-09-30T10:04:00Z" },
    ],
  },
};

function rs(name: string, revision: string, created: string, image: string, owner = "d-1"): Obj {
  return {
    metadata: {
      name, namespace: "shop", uid: `rs-${name}`, creationTimestamp: created,
      annotations: { "deployment.kubernetes.io/revision": revision },
      ownerReferences: [{ kind: "Deployment", name: "web", uid: owner, controller: true }],
    },
    spec: { template: { spec: { containers: [{ name: "app", image }] } } },
  };
}

function pod(name: string, ownerUid: string, statuses: Obj[] = []): Obj {
  return {
    metadata: { name, namespace: "shop", uid: `p-${name}`, ownerReferences: [{ kind: "ReplicaSet", name: "x", uid: ownerUid, controller: true }] },
    status: { containerStatuses: statuses },
  };
}

function ev(kind: string, name: string, reason: string, at: string, type = "Normal", extra: Obj = {}): Obj {
  return {
    metadata: { name: `${name}.${reason}`, namespace: "shop", creationTimestamp: "2026-09-01T00:00:00Z" },
    involvedObject: { kind, name, namespace: "shop" },
    reason, message: `${reason} happened`, type, lastTimestamp: at, ...extra,
  };
}

const base = { obj: deploy, events: [] as Obj[], replicaSets: [] as Obj[], pods: [] as Obj[] };

describe("buildTimeline", () => {
  it("merges the workload's events with those of its ReplicaSets and pods, newest first", () => {
    const t = buildTimeline({
      ...base,
      replicaSets: [rs("web-2", "2", "2026-09-30T10:00:00Z", "shop/web:2")],
      pods: [pod("web-2-abc", "rs-web-2")],
      events: [
        ev("Deployment", "web", "ScalingReplicaSet", "2026-09-30T10:00:01Z"),
        ev("ReplicaSet", "web-2", "SuccessfulCreate", "2026-09-30T10:00:02Z"),
        ev("Pod", "web-2-abc", "BackOff", "2026-09-30T10:03:00Z", "Warning"),
        ev("Pod", "someone-else", "BackOff", "2026-09-30T10:03:30Z", "Warning"),
      ],
    });
    const evs = t.filter((e) => e.source === "event");
    expect(evs.map((e) => e.title)).toEqual(["BackOff", "SuccessfulCreate", "ScalingReplicaSet"]);
    expect(evs[0]).toMatchObject({ subject: "Pod/web-2-abc", severity: "warning", detail: "BackOff happened" });
  });

  it("adds a rollout entry per owned ReplicaSet with its revision and images", () => {
    const t = buildTimeline({
      ...base,
      replicaSets: [
        rs("web-1", "1", "2026-09-20T09:00:00Z", "shop/web:1"),
        rs("web-2", "2", "2026-09-30T10:00:00Z", "shop/web:2"),
        rs("other-1", "1", "2026-09-30T11:00:00Z", "x", "someone-else"),
      ],
    });
    const r = t.filter((e) => e.source === "rollout");
    expect(r.map((e) => e.title)).toEqual(["Revision 2", "Revision 1"]);
    expect(r[0]).toMatchObject({ at: "2026-09-30T10:00:00Z", subject: "ReplicaSet/web-2", detail: "app=shop/web:2" });
  });

  it("adds condition transitions from the workload's status", () => {
    const t = buildTimeline(base);
    const c = t.filter((e) => e.source === "condition");
    expect(c.map((e) => e.title)).toEqual(["Available → True", "Progressing → True"]);
    expect(c[0]!.detail).toBe("MinimumReplicasAvailable");
    expect(c[1]!.detail).toBe("NewReplicaSetAvailable: ReplicaSet web-2 has successfully progressed.");
  });

  it("marks a False Available/Ready condition as a warning", () => {
    const t = buildTimeline({
      ...base,
      obj: { ...deploy, status: { conditions: [{ type: "Available", status: "False", lastTransitionTime: "2026-09-30T10:00:00Z" }] } },
    });
    expect(t[0]).toMatchObject({ source: "condition", severity: "warning" });
  });

  it("adds container terminations from pods' last state, OOMKilled as a warning", () => {
    const t = buildTimeline({
      ...base,
      replicaSets: [rs("web-2", "2", "2026-09-30T10:00:00Z", "shop/web:2")],
      pods: [
        pod("web-2-abc", "rs-web-2", [
          { name: "app", restartCount: 3, lastState: { terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-09-30T10:10:00Z" } } },
        ]),
      ],
    });
    const c = t.filter((e) => e.source === "container");
    expect(c).toEqual([
      { at: "2026-09-30T10:10:00Z", source: "container", severity: "warning", subject: "Pod/web-2-abc", title: "app terminated: OOMKilled", detail: "exit 137 · 3 restarts" },
    ]);
  });

  it("uses a pod's own events and container states when the object is a Pod", () => {
    const self = pod("solo", "nobody", [{ name: "c", restartCount: 1, lastState: { terminated: { reason: "Error", exitCode: 1, finishedAt: "2026-09-30T08:00:00Z" } } }]);
    const t = buildTimeline({
      obj: { ...self, kind: "Pod" },
      events: [ev("Pod", "solo", "Pulled", "2026-09-30T07:00:00Z")],
      replicaSets: [],
      pods: [],
    });
    expect(t.map((e) => e.source)).toEqual(["container", "event"]);
  });

  it("falls back to eventTime, then firstTimestamp, then creation for events without lastTimestamp", () => {
    const e1 = ev("Deployment", "web", "A", "", "Normal", { lastTimestamp: null, eventTime: "2026-09-30T12:00:00.000000Z" });
    const e2 = ev("Deployment", "web", "B", "", "Normal", { lastTimestamp: null, firstTimestamp: "2026-09-30T11:00:00Z" });
    const t = buildTimeline({ ...base, obj: { ...deploy, status: {} }, events: [e2, e1] });
    expect(t.map((e) => e.title)).toEqual(["A", "B"]);
  });

  it("shows a repeated event's count", () => {
    const t = buildTimeline({ ...base, obj: { ...deploy, status: {} }, events: [ev("Deployment", "web", "X", "2026-09-30T12:00:00Z", "Normal", { count: 4 })] });
    expect(t[0]!.detail).toBe("X happened (×4)");
  });
});
