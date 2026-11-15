import { describe, expect, it } from "vitest";
import { rankNamespaces } from "../namespaceRanking";
import type { AttentionRow } from "../attention";

// Overview v2, below the fold: which namespace (which team) is noisy. By
// broken pods plus warnings by default, by requests on a toggle.

type Obj = Record<string, unknown>;
const NOW = Date.parse("2026-10-02T12:00:00Z");

const pod = (ns: string, cpu = "100m", memory = "128Mi"): Obj => ({
  metadata: { name: Math.random().toString(36), namespace: ns },
  spec: { nodeName: "n1", containers: [{ name: "c", resources: { requests: { cpu, memory } } }] },
  status: { phase: "Running" },
});
const broken = (ns: string, pods: number): AttentionRow =>
  ({ key: `Deployment/${ns}/x`, kind: "Deployment", namespace: ns, name: "x", code: "CrashLoopBackOff", plain: "", detail: "", severity: "err", ready: 0, desired: pods, restarts: 0, pods: Array.from({ length: pods }, (_, i) => `${ns}/p${i}`) }) as AttentionRow;
const warn = (ns: string, count: number, minAgo = 5): Obj => ({ type: "Warning", count, lastTimestamp: new Date(NOW - minAgo * 60_000).toISOString(), metadata: { namespace: ns } });

describe("rankNamespaces", () => {
  const pods = [pod("shop"), pod("shop"), pod("pay", "2", "4Gi"), pod("batch"), pod("batch"), pod("batch")];

  it("ranks by broken pods, then warnings in the last hour", () => {
    const rows = rankNamespaces({ pods, attention: [broken("pay", 1), broken("shop", 2)], events: [warn("batch", 9), warn("shop", 1), warn("pay", 50, 90)], by: "problems", now: NOW });
    expect(rows.map((r) => `${r.namespace}:${r.broken}:${r.warnings}:${r.pods}`)).toEqual(["shop:2:1:2", "pay:1:0:1", "batch:0:9:3"]);
  });

  it("ranks by CPU requested on the toggle, with each share of the cluster's requests", () => {
    const rows = rankNamespaces({ pods, attention: [], events: [], by: "requests", now: NOW });
    expect(rows[0]).toMatchObject({ namespace: "pay", cpuRequested: 2000, memRequested: 4 * 1024 ** 3 });
    expect(rows[0]!.cpuShare).toBe(80);
    expect(rows.map((r) => r.namespace)).toEqual(["pay", "batch", "shop"]);
  });

  it("keeps the top ten", () => {
    const many = Array.from({ length: 14 }, (_, i) => pod(`ns${i}`));
    expect(rankNamespaces({ pods: many, attention: [], events: [], by: "problems", now: NOW })).toHaveLength(10);
  });
});
