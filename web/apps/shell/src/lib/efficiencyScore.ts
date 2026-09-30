import type { WorkloadWaste } from "./api";
import type { ClusterWaste } from "./waste";
import { computeEngineRightSizingRows, SUPPORTED_KINDS } from "./rightsizing";

export type EfficiencyKey = "provisioning" | "coverage" | "optimization";

export interface EfficiencyComponent {
  key: EfficiencyKey;
  label: string;
  /** 0–100, rounded. */
  score: number;
  detail: string;
}

export interface EfficiencyScore {
  /** 0–100, or null when the cluster has no allocatable capacity to score. */
  score: number | null;
  grade: "good" | "fair" | "poor" | null;
  components: EfficiencyComponent[];
  /** Components left out for lack of data; their weight is spread over the rest. */
  missing: EfficiencyKey[];
}

const WEIGHTS: Record<EfficiencyKey, number> = { provisioning: 0.5, coverage: 0.2, optimization: 0.3 };

/** Requests at or above this share of allocatable earn full provisioning marks; the rest is burst headroom. */
const TARGET_REQUESTED_SHARE = 0.8;

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function pct(n: number): number {
  return Math.round(Math.min(Math.max(n, 0), 1) * 100);
}

/**
 * Roadmap Tier 1 #5: one local 0–100 efficiency score, blended from numbers
 * the Cost / Waste page already computes — no new data source and no
 * cross-cluster benchmark. Three parts:
 *   - provisioning: requests vs allocatable (lib/waste.ts), CPU and memory averaged;
 *   - coverage: share of scheduled containers that set requests at all;
 *   - optimization: share of measured workloads that pass the right-sizing
 *     materiality gate, so the score and the Right-sizing list never disagree.
 * Optimization needs usage data (metrics-server or Prometheus); without it the
 * part is dropped and the other weights are renormalized, never guessed.
 */
export function computeEfficiencyScore(
  waste: ClusterWaste,
  pods: Record<string, unknown>[],
  workloads: WorkloadWaste[] | undefined,
): EfficiencyScore {
  let allocCpu = 0, allocMem = 0, reqCpu = 0, reqMem = 0;
  for (const n of waste.nodes) {
    allocCpu += n.allocatableCpuMillis;
    allocMem += n.allocatableMemBytes;
    reqCpu += n.requestedCpuMillis;
    reqMem += n.requestedMemBytes;
  }
  if (allocCpu <= 0 && allocMem <= 0) return { score: null, grade: null, components: [], missing: [] };

  const components: EfficiencyComponent[] = [];
  const missing: EfficiencyKey[] = [];

  const cpuShare = allocCpu > 0 ? reqCpu / allocCpu : 0;
  const memShare = allocMem > 0 ? reqMem / allocMem : 0;
  components.push({
    key: "provisioning",
    label: "Provisioning",
    score: Math.round((pct(cpuShare / TARGET_REQUESTED_SHARE) + pct(memShare / TARGET_REQUESTED_SHARE)) / 2),
    detail: `${Math.round(cpuShare * 100)}% of CPU and ${Math.round(memShare * 100)}% of memory requested (target ${TARGET_REQUESTED_SHARE * 100}%)`,
  });

  let scheduled = 0;
  for (const p of pods) {
    const spec = rec(p.spec);
    if (typeof spec.nodeName !== "string" || !spec.nodeName) continue;
    scheduled += Array.isArray(spec.containers) ? spec.containers.length : 0;
  }
  const unrequested = waste.unrequestedContainers.length;
  if (scheduled > 0) {
    components.push({
      key: "coverage",
      label: "Request coverage",
      score: pct((scheduled - unrequested) / scheduled),
      detail: `${scheduled - unrequested} of ${scheduled} containers set resource requests`,
    });
  } else {
    missing.push("coverage");
  }

  const measured = (workloads ?? []).filter((w) => SUPPORTED_KINDS.has(w.kind));
  if (measured.length > 0) {
    const overProvisioned = computeEngineRightSizingRows(measured, []).length;
    components.push({
      key: "optimization",
      label: "Workload sizing",
      score: pct((measured.length - overProvisioned) / measured.length),
      detail: `${measured.length - overProvisioned} of ${measured.length} workloads sized close to their p95 usage`,
    });
  } else {
    missing.push("optimization");
  }

  const weight = components.reduce((s, c) => s + WEIGHTS[c.key], 0);
  const score = Math.round(components.reduce((s, c) => s + c.score * WEIGHTS[c.key], 0) / weight);
  return { score, grade: score >= 75 ? "good" : score >= 50 ? "fair" : "poor", components, missing };
}
