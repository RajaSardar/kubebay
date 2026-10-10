import type { GpuPod } from "./gpuCapacity";

/**
 * Backlog #40 Phase 1: how busy the GPUs pods have claimed actually are, from
 * NVIDIA's DCGM exporter through the cluster's Prometheus. Every query is a
 * 24h window sampled every 5 minutes, so the sample count says how much of
 * the window Prometheus actually has.
 */
export const GPU_UTIL_QUERIES = {
  utilAvg: "avg_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])",
  utilMax: "max_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])",
  samples: "count_over_time(DCGM_FI_DEV_GPU_UTIL[24h:5m])",
  // MIG slices don't report GPU_UTIL; graphics-engine activity (a 0–1 ratio) is their equivalent.
  engineAvg: "avg_over_time(DCGM_FI_PROF_GR_ENGINE_ACTIVE[24h:5m])",
  engineMax: "max_over_time(DCGM_FI_PROF_GR_ENGINE_ACTIVE[24h:5m])",
  engineSamples: "count_over_time(DCGM_FI_PROF_GR_ENGINE_ACTIVE[24h:5m])",
  fbUsedMax: "max_over_time(DCGM_FI_DEV_FB_USED[24h:5m])",
  fbTotal: "DCGM_FI_DEV_FB_USED + DCGM_FI_DEV_FB_FREE",
} as const;

export type GpuQueryKey = keyof typeof GPU_UTIL_QUERIES;
export type PromSeries = { metric: Record<string, string>; value: [number, string] };
export type GpuQueryResults = Record<GpuQueryKey, PromSeries[]>;

const STEP_MINUTES = 5;
/** Below this much data a quiet GPU may just be between jobs. */
export const MIN_HOURS = 6;
/** Underused: averages under this… */
export const UNDERUSED_AVG = 10;
/** …and never peaks above this (percent). */
export const UNDERUSED_PEAK = 30;

export type GpuVerdict = "underused" | "busy" | "too-little-data" | "no-data";

export interface GpuUtilRow {
  namespace: string;
  pod: string;
  /** The GPU resources the pod claims, e.g. "nvidia.com/gpu". */
  resource: string;
  gpus: number;
  /** Percent, averaged across the pod's GPUs. */
  avgUtil: number | null;
  /** Percent, the highest any of its GPUs reached. */
  peakUtil: number | null;
  /** Hours of the 24h window Prometheus has, for the least-observed GPU. */
  hoursObserved: number;
  /** MiB, the most framebuffer any one of its GPUs used. */
  fbPeakMiB: number | null;
  fbTotalMiB: number | null;
  source: "gpu-util" | "engine-active" | null;
  verdict: GpuVerdict;
}

export interface GpuUtilisation {
  rows: GpuUtilRow[];
  /** Any DCGM series at all: false means no exporter in this Prometheus. */
  dcgmFound: boolean;
}

/**
 * The workload pod a DCGM series is about. The exporter labels it pod and
 * namespace (pod_name and pod_namespace with --use-old-namespace). Scraped
 * with honorLabels: false, the default in NVIDIA's charts, Prometheus keeps
 * its own pod/namespace (the exporter's) and renames the exporter's to
 * exported_pod/exported_namespace.
 */
function podOf(m: Record<string, string>): string {
  if (m.exported_pod) return `${m.exported_namespace ?? ""}/${m.exported_pod}`;
  if (m.pod_name) return `${m.pod_namespace ?? ""}/${m.pod_name}`;
  return `${m.namespace ?? ""}/${m.pod ?? ""}`;
}

function gpuOf(m: Record<string, string>): string {
  return `${m.UUID ?? `${m.Hostname ?? ""}:${m.gpu ?? ""}`}|${m.GPU_I_ID ?? ""}`;
}

type GpuStats = { avg?: number; max?: number; samples?: number; fbPeak?: number; fbTotal?: number; source?: "gpu-util" | "engine-active" };

const round1 = (n: number) => Math.round(n * 10) / 10;
const RANK: Record<GpuVerdict, number> = { underused: 0, busy: 1, "too-little-data": 2, "no-data": 3 };

export function summarizeGpuUtilisation(pods: GpuPod[], res: GpuQueryResults): GpuUtilisation {
  const dcgmFound = Object.values(res).some((r) => r.length > 0);

  // pod -> gpu -> stats
  const stats = new Map<string, Map<string, GpuStats>>();
  const put = (key: GpuQueryKey, field: keyof Omit<GpuStats, "source">, scale = 1, source?: GpuStats["source"], onlyIfMissing = false) => {
    for (const s of res[key] ?? []) {
      const v = Number(s.value[1]);
      if (!Number.isFinite(v)) continue;
      const pod = podOf(s.metric);
      const gpus = stats.get(pod) ?? new Map<string, GpuStats>();
      const g = gpus.get(gpuOf(s.metric)) ?? {};
      if (onlyIfMissing && g.source === "gpu-util") continue;
      g[field] = v * scale;
      if (source) g.source = source;
      gpus.set(gpuOf(s.metric), g);
      stats.set(pod, gpus);
    }
  };
  put("utilAvg", "avg", 1, "gpu-util");
  put("utilMax", "max", 1, "gpu-util");
  put("samples", "samples", 1, "gpu-util");
  put("engineAvg", "avg", 100, "engine-active", true);
  put("engineMax", "max", 100, "engine-active", true);
  put("engineSamples", "samples", 1, "engine-active", true);
  put("fbUsedMax", "fbPeak");
  put("fbTotal", "fbTotal");

  // One row per pod that claims an NVIDIA GPU; DCGM sees nothing else, and the
  // exporter's own pod never matches because it claims none.
  const claimed = new Map<string, { namespace: string; pod: string; resources: Set<string>; gpus: number }>();
  for (const p of pods) {
    if (!p.resource.startsWith("nvidia.com/")) continue;
    const key = `${p.namespace}/${p.pod}`;
    const c = claimed.get(key) ?? { namespace: p.namespace, pod: p.pod, resources: new Set<string>(), gpus: 0 };
    c.resources.add(p.resource);
    c.gpus += p.count;
    claimed.set(key, c);
  }

  const rows: GpuUtilRow[] = [];
  for (const [key, c] of claimed) {
    const gpus = [...(stats.get(key)?.values() ?? [])].filter((g) => g.avg !== undefined);
    const base = { namespace: c.namespace, pod: c.pod, resource: [...c.resources].sort().join(", "), gpus: c.gpus };
    if (gpus.length === 0) {
      rows.push({ ...base, avgUtil: null, peakUtil: null, hoursObserved: 0, fbPeakMiB: null, fbTotalMiB: null, source: null, verdict: "no-data" });
      continue;
    }
    const avgUtil = round1(gpus.reduce((a, g) => a + (g.avg ?? 0), 0) / gpus.length);
    const peakUtil = round1(Math.max(...gpus.map((g) => g.max ?? g.avg ?? 0)));
    const hoursObserved = round1((Math.min(...gpus.map((g) => g.samples ?? 0)) * STEP_MINUTES) / 60);
    const fbPeaks = gpus.map((g) => g.fbPeak).filter((v): v is number => v !== undefined);
    const fbTotals = gpus.map((g) => g.fbTotal).filter((v): v is number => v !== undefined);
    const verdict: GpuVerdict =
      hoursObserved < MIN_HOURS ? "too-little-data" : avgUtil < UNDERUSED_AVG && peakUtil < UNDERUSED_PEAK ? "underused" : "busy";
    rows.push({
      ...base,
      avgUtil,
      peakUtil,
      hoursObserved,
      fbPeakMiB: fbPeaks.length ? Math.max(...fbPeaks) : null,
      fbTotalMiB: fbTotals.length ? Math.max(...fbTotals) : null,
      source: gpus.some((g) => g.source === "engine-active") && !gpus.some((g) => g.source === "gpu-util") ? "engine-active" : "gpu-util",
      verdict,
    });
  }
  rows.sort((a, b) => RANK[a.verdict] - RANK[b.verdict] || a.namespace.localeCompare(b.namespace) || a.pod.localeCompare(b.pod));
  return { rows, dcgmFound };
}
