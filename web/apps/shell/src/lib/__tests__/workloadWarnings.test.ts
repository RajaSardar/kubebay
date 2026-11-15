import { describe, expect, it } from "vitest";
import { workloadWarnings } from "../workloadWarnings";

// The drawer's "new or chronic?" answer: a workload's warning events over the
// last hour (events live about an hour), in twelve 5-minute buckets.

const NOW = Date.parse("2026-10-03T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const deploy = {
  kind: "Deployment",
  metadata: { name: "api", namespace: "shop" },
  spec: { selector: { matchLabels: { app: "api" } } },
};
const pods = [
  { metadata: { name: "api-7f9-a", namespace: "shop", labels: { app: "api" } } },
  { metadata: { name: "api-gateway-1", namespace: "shop", labels: { app: "gateway" } } },
  { metadata: { name: "api-7f9-z", namespace: "other", labels: { app: "api" } } },
];
function ev(kind: string, name: string, minAgo: number, extra: Record<string, unknown> = {}) {
  return {
    type: "Warning",
    reason: "BackOff",
    involvedObject: { kind, name, namespace: "shop" },
    lastTimestamp: ago(minAgo),
    count: 1,
    ...extra,
  };
}

describe("workloadWarnings", () => {
  it("counts warnings on the workload, its pods (by selector) and its ReplicaSets, in the last hour only", () => {
    const w = workloadWarnings(
      [
        ev("Deployment", "api", 2),
        ev("Pod", "api-7f9-a", 7),
        ev("ReplicaSet", "api-7f9", 12),
        { ...ev("Pod", "api-7f9-a", 3), type: "Normal" },
        ev("Pod", "api-gateway-1", 3), // name looks alike, labels say another app
        { ...ev("Pod", "api-7f9-z", 3), involvedObject: { kind: "Pod", name: "api-7f9-z", namespace: "other" } },
        ev("Pod", "api-7f9-a", 75), // older than the hour
      ],
      pods,
      deploy,
      NOW,
    )!;
    expect(w.total).toBe(3);
    expect(w.buckets).toHaveLength(12);
    // Oldest bucket first: 12 min ago is bucket 9, 7 min ago bucket 10, 2 min ago bucket 11.
    expect(w.buckets.slice(9)).toEqual([1, 1, 1]);
    expect(w.buckets.slice(0, 9).every((n) => n === 0)).toBe(true);
  });

  it("spreads a repeated event's count across the time it was repeating", () => {
    const w = workloadWarnings([ev("Pod", "api-7f9-a", 0, { firstTimestamp: ago(20), count: 4 })], pods, deploy, NOW)!;
    expect(w.total).toBe(4);
    expect(w.buckets.slice(8)).toEqual([1, 1, 1, 1]);
  });

  it("says whether it is new or has gone on all hour", () => {
    expect(workloadWarnings([ev("Pod", "api-7f9-a", 4)], pods, deploy, NOW)!.onset).toBe("new");
    expect(workloadWarnings([ev("Pod", "api-7f9-a", 0, { firstTimestamp: ago(58) })], pods, deploy, NOW)!.onset).toBe("all hour");
    const mid = workloadWarnings([ev("Pod", "api-7f9-a", 30)], pods, deploy, NOW)!;
    expect(mid.onset).toBe("started");
    expect(mid.firstAt).toBe(NOW - 30 * 60_000);
  });

  it("is null when the workload has had no warnings this hour", () => {
    expect(workloadWarnings([], pods, deploy, NOW)).toBeNull();
    expect(workloadWarnings([{ ...ev("Pod", "api-7f9-a", 3), type: "Normal" }], pods, deploy, NOW)).toBeNull();
  });

  it("only takes ReplicaSet events for a Deployment", () => {
    const sts = { ...deploy, kind: "StatefulSet" };
    expect(workloadWarnings([ev("ReplicaSet", "api-7f9", 3)], pods, sts, NOW)).toBeNull();
  });
});
