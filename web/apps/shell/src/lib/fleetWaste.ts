import type { WorkloadWaste } from "./api";
import { computeEngineRightSizingRows } from "./rightsizing";

export interface FleetClusterWaste {
  cluster: string;
  wastedCpuMillis: number;
  wastedMemBytes: number;
  /** Number of workloads whose waste passed the materiality gate. */
  opportunities: number;
}

export interface FleetWasteSummary {
  totalWastedCpuMillis: number;
  totalWastedMemBytes: number;
  perCluster: FleetClusterWaste[];
}

/**
 * Backlog #15 Phase 2: sums fleet-wide wasted capacity from each cluster's
 * own /api/waste/workloads response — directly the "for loop over the
 * per-cluster computation" #6's designer predicted. Reuses
 * computeEngineRightSizingRows rather than re-deriving waste, so a
 * workload only counts here if it would also show up as a real
 * opportunity on the single-cluster Right-sizing page (same materiality
 * gate, no double standard between the two views).
 */
export function summarizeFleetWaste(byCluster: { cluster: string; waste: WorkloadWaste[] }[]): FleetWasteSummary {
  const perCluster: FleetClusterWaste[] = byCluster.map(({ cluster, waste }) => {
    const rows = computeEngineRightSizingRows(waste, []);
    return {
      cluster,
      wastedCpuMillis: rows.reduce((s, r) => s + r.wastedCpuMillis, 0),
      wastedMemBytes: rows.reduce((s, r) => s + r.wastedMemBytes, 0),
      opportunities: rows.length,
    };
  });

  return {
    totalWastedCpuMillis: perCluster.reduce((s, c) => s + c.wastedCpuMillis, 0),
    totalWastedMemBytes: perCluster.reduce((s, c) => s + c.wastedMemBytes, 0),
    perCluster,
  };
}
