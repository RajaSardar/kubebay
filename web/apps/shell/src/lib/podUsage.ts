import { parseCpuMillis, parseMemBytes } from "./rightsizing";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/** A pod's total requests and limits (millicores, bytes). A total exists only when every container sets it. */
export interface PodResources {
  cpuRequest?: number;
  cpuLimit?: number;
  memRequest?: number;
  memLimit?: number;
}

export function podResources(pod: Record<string, unknown>): PodResources {
  const containers = (rec(pod.spec).containers ?? []) as Record<string, unknown>[];
  if (containers.length === 0) return {};
  // One container without a limit can use the whole node, so the pod has no
  // limit; a partial sum would understate it.
  const total = (kind: "requests" | "limits", res: "cpu" | "memory") => {
    let sum = 0;
    for (const c of containers) {
      const v = rec(rec(c.resources)[kind])[res];
      if (typeof v !== "string" && typeof v !== "number") return undefined;
      sum += res === "cpu" ? parseCpuMillis(String(v)) : parseMemBytes(String(v));
    }
    return sum > 0 ? sum : undefined;
  };
  const out: PodResources = {
    cpuRequest: total("requests", "cpu"),
    cpuLimit: total("limits", "cpu"),
    memRequest: total("requests", "memory"),
    memLimit: total("limits", "memory"),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as PodResources;
}

export interface UsageBar {
  /** Fill, 0–100, or null for no bar (nothing to measure against). */
  pct: number | null;
  tone: "accent" | "warn" | "err";
  /** Says what the bar measures against, for the tooltip. */
  title: string;
}

/**
 * How full a CPU or memory bar is. Against the limit when there is one:
 * warn at 80%, error at 100% (memory is OOM-killed there, CPU throttled).
 * Otherwise against the request, where going over is normal. Neither: no bar.
 */
export function usageBar(used: number, request: number | undefined, limit: number | undefined, fmt: (n: number) => string): UsageBar {
  if (limit) {
    const pct = Math.round((used / limit) * 100);
    return {
      pct: Math.min(100, pct),
      tone: pct >= 100 ? "err" : pct >= 80 ? "warn" : "accent",
      title: `${fmt(used)} of ${fmt(limit)} limit (${pct}%)`,
    };
  }
  if (request) {
    const pct = Math.round((used / request) * 100);
    return { pct: Math.min(100, pct), tone: "accent", title: `${fmt(used)}, ${pct}% of its ${fmt(request)} request (no limit)` };
  }
  return { pct: null, tone: "accent", title: `${fmt(used)} (no request or limit set)` };
}
