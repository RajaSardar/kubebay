import { describe, expect, it } from "vitest";
import { healthVerdict, warningTrend } from "../verdict";
import type { AttentionRow } from "../attention";
import type { ClusterCapacity } from "../capacity";

// Overview v2's verdict line: a word and colour, a count with its
// denominator, the worst thing by name, a direction, and a capacity warning.

const NOW = Date.parse("2026-10-02T12:00:00Z");
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function row(o: Partial<AttentionRow> & { name: string }): AttentionRow {
  return {
    key: `Deployment/${o.namespace ?? "shop"}/${o.name}`,
    kind: "Deployment",
    namespace: "shop",
    code: "CrashLoopBackOff",
    plain: "Keeps crashing on start",
    detail: "",
    severity: "err",
    ready: 0,
    desired: 1,
    restarts: 0,
    pods: [`shop/${o.name}-1`],
    ...o,
  };
}
const pods = (n: number, ns = "shop") =>
  Array.from({ length: n }, (_, i) => ({ metadata: { name: `p${i}`, namespace: ns }, spec: { nodeName: "n1" }, status: { phase: "Running" } }));
const roomy: ClusterCapacity = {
  cpu: { requested: 1, allocatable: 10, pct: 10, over: false },
  memory: { requested: 1, allocatable: 10, pct: 10, over: false },
};
const warning = (lastMin: number, count = 1) => ({ type: "Warning", lastTimestamp: minAgo(lastMin), count, metadata: { namespace: "shop" } });

describe("healthVerdict", () => {
  it("is calm and counted when nothing is broken", () => {
    expect(healthVerdict({ attention: [], pods: pods(612), capacity: roomy })).toMatchObject({
      tone: "ok",
      word: "Healthy",
      sentence: "All 612 pods healthy",
    });
  });

  it("names the count with its denominator and the worst workload", () => {
    const v = healthVerdict({
      attention: [row({ name: "api", pods: ["shop/a", "shop/b", "shop/c"] }), row({ name: "db", severity: "warn", plain: "Stuck starting" })],
      pods: pods(612),
      capacity: roomy,
    });
    expect(v).toMatchObject({ tone: "err", word: "Failing", sentence: "4 of 612 pods need attention · shop/api: Keeps crashing on start" });
  });

  it("is amber when only warnings, or capacity, are wrong", () => {
    expect(healthVerdict({ attention: [row({ name: "db", severity: "warn", plain: "Stuck starting" })], pods: pods(10), capacity: roomy })).toMatchObject({
      tone: "warn",
      word: "Degraded",
    });
    const full: ClusterCapacity = { ...roomy, memory: { requested: 94, allocatable: 100, pct: 94, over: true } };
    expect(healthVerdict({ attention: [], pods: pods(10), capacity: full })).toMatchObject({
      tone: "warn",
      word: "Degraded",
      sentence: "All 10 pods healthy · memory 94% requested",
    });
  });

  it("counts a workload with no pod to blame", () => {
    const v = healthVerdict({ attention: [row({ name: "quota", pods: [], severity: "warn", plain: "Not enough copies running" })], pods: pods(5), capacity: null });
    expect(v.sentence).toBe("1 workload needs attention · shop/quota: Not enough copies running");
  });

  it("scopes to your namespaces and says how much is outside them", () => {
    const v = healthVerdict({
      attention: [row({ name: "api", namespace: "other" }), row({ name: "web", namespace: "other" })],
      pods: [...pods(3, "shop"), ...pods(4, "other")],
      capacity: roomy,
      scope: ["shop"],
    });
    expect(v).toMatchObject({ tone: "ok", sentence: "All 3 pods healthy", outside: 2 });
  });
});

describe("warningTrend", () => {
  it("is worse when the last 30 minutes saw clearly more warnings than the 30 before", () => {
    expect(warningTrend([warning(5, 6), warning(40, 1)], NOW)).toBe("worse than 30 min ago");
  });
  it("is better when clearly fewer", () => {
    expect(warningTrend([warning(5, 1), warning(40, 8)], NOW)).toBe("better than 30 min ago");
  });
  it("is steady for small changes, and says nothing with no warnings", () => {
    expect(warningTrend([warning(5, 3), warning(40, 2)], NOW)).toBe("steady");
    expect(warningTrend([{ type: "Normal", lastTimestamp: minAgo(5), count: 9 }], NOW)).toBeUndefined();
    expect(warningTrend([], NOW)).toBeUndefined();
  });
});
