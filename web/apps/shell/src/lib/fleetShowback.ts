import type { WorkloadWaste } from "./api";
import { computeEngineRightSizingRows } from "./rightsizing";

export interface ShowbackRow {
  ns: string;
  clusters: string[];
  workloads: number;
  requestedCpuMillis: number;
  requestedMemBytes: number;
  /** Sum of each workload's own p95, an upper bound on concurrent use. */
  p95CpuMillis: number;
  p95MemBytes: number;
  wastedCpuMillis: number;
  wastedMemBytes: number;
}

/**
 * Roadmap Tier 2 #19: fleet-wide showback by namespace name, so "payments"
 * in prod and staging is one team row. Built from the same per-cluster
 * /api/waste/workloads data the Fleet waste total uses, and waste goes
 * through the same right-sizing materiality gate so the two never disagree.
 * No dollars: Kubebay doesn't guess at pricing.
 */
export function summarizeShowback(byCluster: { cluster: string; waste: WorkloadWaste[] }[]): ShowbackRow[] {
  const rows = new Map<string, ShowbackRow>();
  const row = (ns: string): ShowbackRow => {
    let r = rows.get(ns);
    if (!r) {
      r = { ns, clusters: [], workloads: 0, requestedCpuMillis: 0, requestedMemBytes: 0, p95CpuMillis: 0, p95MemBytes: 0, wastedCpuMillis: 0, wastedMemBytes: 0 };
      rows.set(ns, r);
    }
    return r;
  };

  for (const { cluster, waste } of byCluster) {
    for (const w of waste) {
      const r = row(w.ns);
      if (!r.clusters.includes(cluster)) r.clusters.push(cluster);
      r.workloads++;
      r.requestedCpuMillis += w.requestedCpuMillis;
      r.requestedMemBytes += w.requestedMemBytes;
      r.p95CpuMillis += w.p95CpuMillis;
      r.p95MemBytes += w.p95MemBytes;
    }
    for (const opp of computeEngineRightSizingRows(waste, [])) {
      const r = row(opp.ns);
      r.wastedCpuMillis += opp.wastedCpuMillis;
      r.wastedMemBytes += opp.wastedMemBytes;
    }
  }

  return [...rows.values()]
    .map((r) => ({ ...r, clusters: [...r.clusters].sort() }))
    .sort((a, b) => b.requestedCpuMillis - a.requestedCpuMillis || a.ns.localeCompare(b.ns));
}
