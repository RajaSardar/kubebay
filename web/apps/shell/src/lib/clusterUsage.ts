import type { StatusTone } from "@kubebay/ui";
import type { ClusterHistorySummary } from "./api";

/**
 * Clusters page visuals from the local usage history (backlog #36): a week of
 * CPU peaks as a sparkline, and how much of the cluster's allocatable the
 * pods' requests already claim. Both come from what the sampler recorded, so
 * a cluster nobody opened has neither.
 */

function cores(millis: number): string {
  return `${Math.round(millis / 100) / 10}`;
}

export interface Sparkline {
  path: string;
  label: string;
}

export function sparkline(s: ClusterHistorySummary, w: number, h: number): Sparkline | null {
  const vals = s.points.map((p) => p.cpuMax);
  const recorded = vals.filter((v): v is number => v != null);
  if (recorded.length === 0) return null;
  const peak = Math.max(...recorded);
  const scale = s.allocCpuMillis > 0 ? Math.max(s.allocCpuMillis, peak) : peak || 1;
  const step = vals.length > 1 ? w / (vals.length - 1) : w;
  const r = (n: number) => Math.round(n * 10) / 10;
  type Pt = [number, number];
  const runs: Pt[][] = [];
  let run: Pt[] = [];
  vals.forEach((v, i) => {
    if (v == null) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push([r(i * step), r(h - (v / scale) * h)]);
  });
  if (run.length) runs.push(run);
  const path = runs
    .map(([first, ...rest]) => {
      // A lone bucket gets a short stub so it shows up at all.
      const tail = rest.length ? rest : [[r(first![0] + Math.max(1, step / 2)), first![1]] as Pt];
      return `M${first!.join(",")} L${tail.map((p) => p.join(",")).join(" ")}`;
    })
    .join(" ");
  const label =
    s.allocCpuMillis > 0
      ? `CPU peak over the last 7 days: ${cores(peak)} of ${cores(s.allocCpuMillis)} cores (${Math.round((peak / s.allocCpuMillis) * 100)}%)`
      : `CPU peak over the last 7 days: ${cores(peak)} cores`;
  return { path, label };
}

export interface Headroom {
  cpuPct: number;
  memPct: number;
  tone: StatusTone;
  label: string;
}

export function headroom(s: ClusterHistorySummary): Headroom | null {
  if (s.allocCpuMillis <= 0) return null;
  const latest = [...s.points].reverse().find((p) => p.reqCpuMillis != null);
  if (!latest) return null;
  const cpuPct = Math.round(((latest.reqCpuMillis ?? 0) / s.allocCpuMillis) * 100);
  const memPct = s.allocMemBytes > 0 ? Math.round(((latest.reqMemBytes ?? 0) / s.allocMemBytes) * 100) : 0;
  const worst = Math.max(cpuPct, memPct);
  const tone: StatusTone = worst >= 90 ? "err" : worst >= 75 ? "warn" : "ok";
  const nodes = s.nodes === 1 ? "1 node" : `${s.nodes} nodes`;
  return { cpuPct, memPct, tone, label: `Requests use ${cpuPct}% of allocatable CPU and ${memPct}% of memory on ${nodes}` };
}

export function lastOpenedLabel(ts: number | undefined, now = Date.now()): string {
  if (!ts) return "";
  const s = Math.max(0, (now - ts) / 1000);
  if (s < 60) return "Opened just now";
  if (s < 3600) return `Opened ${Math.round(s / 60)}m ago`;
  if (s < 86400) return `Opened ${Math.round(s / 3600)}h ago`;
  return `Opened ${Math.round(s / 86400)}d ago`;
}
