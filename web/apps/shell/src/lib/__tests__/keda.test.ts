import { describe, it, expect } from "vitest";
import { explainScaledObject, hpaConflictsWithScaledObject, kedaPause } from "../keda";

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

  // KEDA pauses through annotations, not a spec field: spec.advanced has no
  // "paused", and the API server drops it. (Root backlog #24.)
  it("reads paused from KEDA's annotations, not a spec field", () => {
    const base = { scaleTargetRef: { name: "app", kind: "Deployment" }, minReplicaCount: 1, maxReplicaCount: 20, triggers: [] };
    expect(explainScaledObject(scaledObject({ metadata: { name: "so", namespace: "prod", annotations: { "autoscaling.keda.sh/paused": "true" } }, spec: base })).paused).toBe(true);
    expect(explainScaledObject(scaledObject({ spec: { ...base, advanced: { paused: "true" } } })).paused).toBe(false);
  });
});

describe("kedaPause", () => {
  const obj = (annotations: Record<string, string> = {}, conditions: { type: string; status: string }[] = []) => ({
    metadata: { name: "so", namespace: "prod", annotations },
    status: { conditions },
  });

  it("is paused at a replica count with paused-replicas (KEDA 2.7+)", () => {
    expect(kedaPause(obj({ "autoscaling.keda.sh/paused-replicas": "0" }))).toEqual({ paused: true, label: "Yes, at 0 replicas", replicas: 0 });
    expect(kedaPause(obj({ "autoscaling.keda.sh/paused-replicas": "1" })).label).toBe("Yes, at 1 replica");
  });

  it("is paused where it stands with paused: true (KEDA 2.13+)", () => {
    expect(kedaPause(obj({ "autoscaling.keda.sh/paused": "true" }))).toEqual({ paused: true, label: "Yes" });
  });

  it("is paused when KEDA reports the Paused condition", () => {
    expect(kedaPause(obj({}, [{ type: "Paused", status: "True" }])).paused).toBe(true);
  });

  it("isn't paused otherwise, or once paused is set back to false", () => {
    expect(kedaPause(obj())).toEqual({ paused: false, label: "No" });
    expect(kedaPause(obj({ "autoscaling.keda.sh/paused": "false" }, [{ type: "Paused", status: "False" }]))).toEqual({ paused: false, label: "No" });
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
