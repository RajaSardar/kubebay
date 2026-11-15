import { describe, it, expect } from "vitest";
import { explainScaledObject, hpaConflictsWithScaledObject, scaledObjectPauseState, detectKeda, filterKedaRows } from "../keda";

function scaledObject(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-so", namespace: "default" },
    spec: {
      scaleTargetRef: { name: "app", kind: "Deployment" },
      minReplicaCount: 1,
      maxReplicaCount: 20,
      triggers: [{ type: "cpu", metadata: { value: "50" } }],
    },
    status: { currentReplicas: 3 },
    ...overrides,
  };
}

function hpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-hpa", namespace: "default" },
    spec: { scaleTargetRef: { name: "app", kind: "Deployment" } },
    ...overrides,
  };
}

describe("explainScaledObject", () => {
  it("summarizes the min/max/current replica range", () => {
    const e = explainScaledObject(scaledObject());
    expect(e.minReplicas).toBe(1);
    expect(e.maxReplicas).toBe(20);
    expect(e.currentReplicas).toBe(3);
    expect(e.targetName).toBe("app");
    expect(e.targetKind).toBe("Deployment");
  });

  it("defaults minReplicaCount to 0 when unset, and flags it", () => {
    const so = scaledObject({ spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, maxReplicaCount: 10, triggers: [] } });
    const e = explainScaledObject(so);
    expect(e.minReplicas).toBe(0);
    expect(e.minReplicaZero).toBe(true);
  });

  it("does not flag minReplicaZero when min is >= 1", () => {
    const e = explainScaledObject(scaledObject());
    expect(e.minReplicaZero).toBe(false);
  });

  it("describes a cron trigger in plain English", () => {
    const so = scaledObject({
      spec: {
        scaleTargetRef: { name: "app", kind: "Deployment" },
        minReplicaCount: 1,
        maxReplicaCount: 20,
        triggers: [
          { type: "cron", metadata: { timezone: "America/New_York", start: "0 9 * * 1-5", end: "0 17 * * 1-5", desiredReplicas: "20" } },
        ],
      },
    });
    const e = explainScaledObject(so);
    expect(e.summary).toContain("1");
    expect(e.summary).toContain("20");
    expect(e.triggerDescriptions[0]).toMatch(/cron/i);
    expect(e.triggerDescriptions[0]).toContain("America/New_York");
  });

  it("falls back to the raw trigger type for an unrecognized trigger", () => {
    const so = scaledObject({
      spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, minReplicaCount: 1, maxReplicaCount: 5, triggers: [{ type: "postgresql", metadata: {} }] },
    });
    const e = explainScaledObject(so);
    expect(e.triggerDescriptions[0]).toMatch(/postgresql/i);
  });

  it("flags paused via the autoscaling.keda.sh/paused annotation", () => {
    const so = scaledObject({ metadata: { name: "so", namespace: "prod", annotations: { "autoscaling.keda.sh/paused": "true" } } });
    expect(explainScaledObject(so).paused).toBe(true);
  });
});

describe("scaledObjectPauseState", () => {
  const withMeta = (annotations: Record<string, string>, conditions?: unknown[]) => ({
    metadata: { name: "so", namespace: "prod", annotations },
    spec: {},
    status: conditions ? { conditions } : undefined,
  });

  it("is active with no annotation or condition", () => {
    expect(scaledObjectPauseState(withMeta({}))).toEqual({ paused: false, replicas: undefined });
  });
  it("is paused by the paused annotation", () => {
    expect(scaledObjectPauseState(withMeta({ "autoscaling.keda.sh/paused": "true" })).paused).toBe(true);
  });
  it("is not paused when the annotation is false", () => {
    expect(scaledObjectPauseState(withMeta({ "autoscaling.keda.sh/paused": "false" })).paused).toBe(false);
  });
  it("is paused by paused-replicas and reports the count", () => {
    expect(scaledObjectPauseState(withMeta({ "autoscaling.keda.sh/paused-replicas": "3" }))).toEqual({ paused: true, replicas: 3 });
  });
  it("is paused by a Paused=True status condition", () => {
    expect(scaledObjectPauseState(withMeta({}, [{ type: "Paused", status: "True" }])).paused).toBe(true);
  });
  it("is not paused by a Paused=False condition", () => {
    expect(scaledObjectPauseState(withMeta({}, [{ type: "Paused", status: "False" }])).paused).toBe(false);
  });
});

describe("detectKeda", () => {
  const crd = (resource: string) => ({ group: "keda.sh", resource, gvr: `keda.sh/v1alpha1/${resource}` }) as never;
  it("detects ScaledJobs", () => {
    const d = detectKeda([crd("scaledobjects"), crd("scaledjobs")]);
    expect(d.scaledJobGvr).toBe("keda.sh/v1alpha1/scaledjobs");
  });
});

describe("filterKedaRows", () => {
  const rows = [
    { kind: "ScaledObject" as const, name: "orders", ns: "prod", gvr: "g" },
    { kind: "ScaledJob" as const, name: "batch", ns: "prod", gvr: "g" },
    { kind: "ClusterTriggerAuthentication" as const, name: "aws", ns: "", gvr: "g" },
  ];
  it("returns everything for All with empty search", () => {
    expect(filterKedaRows(rows, "all", "")).toHaveLength(3);
  });
  it("narrows by kind", () => {
    expect(filterKedaRows(rows, "ScaledJob", "").map((r) => r.name)).toEqual(["batch"]);
  });
  it("searches name, namespace and kind case-insensitively", () => {
    expect(filterKedaRows(rows, "all", "PROD")).toHaveLength(2);
    expect(filterKedaRows(rows, "all", "clustertrigger").map((r) => r.name)).toEqual(["aws"]);
  });
});

describe("hpaConflictsWithScaledObject", () => {
  it("flags an HPA that scales the same target", () => {
    expect(hpaConflictsWithScaledObject(scaledObject(), [hpa()])).toBe(true);
  });

  it("does not flag an HPA scaling a different target", () => {
    const otherHpa = hpa({ spec: { scaleTargetRef: { name: "other", kind: "Deployment" } } });
    expect(hpaConflictsWithScaledObject(scaledObject(), [otherHpa])).toBe(false);
  });

  it("returns false when there are no HPAs", () => {
    expect(hpaConflictsWithScaledObject(scaledObject(), [])).toBe(false);
  });
});
