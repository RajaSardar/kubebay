import { describe, it, expect } from "vitest";
import { explainScaledObject, hpaConflictsWithScaledObject } from "../keda";

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

  it("flags paused via spec.advanced.paused", () => {
    const so = scaledObject({
      spec: {
        scaleTargetRef: { name: "app", kind: "Deployment" },
        minReplicaCount: 1,
        maxReplicaCount: 20,
        triggers: [],
        advanced: { paused: "true" },
      },
    });
    expect(explainScaledObject(so).paused).toBe(true);
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
