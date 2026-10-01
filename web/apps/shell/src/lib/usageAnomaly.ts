import type { HistoryPoint } from "./headroomForecast";

/**
 * Usage/cost anomaly detection (Intelligence roadmap Tier 2 #21, backlog #36
 * slice 3b) over the local usage history. Each recent well-sampled hour is
 * compared with the same local hour on prior observed days of the same kind
 * (weekday or weekend). With a laptop recording only while the app is open,
 * a same-hour-of-day baseline is the only one that can fill; same-hour-of-week
 * would need weeks of identical hours. Nothing is flagged without at least
 * ANOMALY_MIN_BASELINE_DAYS such days.
 *
 * A value is unusual only when it clears all three bars: 3 scaled MADs from
 * the median (robust to the odd spike already in the baseline), a 25%
 * relative change, and an absolute floor so a 10m→30m wobble isn't news.
 */

export const ANOMALY_MIN_BASELINE_DAYS = 5;

export type AnomalyMetric = "cpuUsage" | "memUsage" | "cpuRequests" | "memRequests";

export interface UsageAnomaly {
  /** The hour that looked unusual (the point's own timestamp). */
  at: string;
  metric: AnomalyMetric;
  value: number;
  /** Median of the baseline hours. */
  usual: number;
  baselineDays: number;
  direction: "up" | "down";
  /** value / usual. */
  ratio: number;
}

const FIELDS: [AnomalyMetric, keyof HistoryPoint, number][] = [
  ["cpuUsage", "cpuMean", 50],
  ["memUsage", "memMean", 64 * 1024 * 1024],
  ["cpuRequests", "reqCpuMillis", 50],
  ["memRequests", "reqMemBytes", 64 * 1024 * 1024],
];

const MAD_K = 3;
const MAD_SCALE = 1.4826;
const MIN_RELATIVE = 0.25;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function dayIndex(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export function findUsageAnomalies(
  points: HistoryPoint[],
  opts: { now?: Date; windowHours?: number } = {},
): UsageAnomaly[] {
  const now = opts.now ?? new Date();
  const since = now.getTime() - (opts.windowHours ?? 24) * 3_600_000;
  const well = points.filter((p) => p.wellSampled).map((p) => ({ p, d: new Date(p.t) }));
  const out: UsageAnomaly[] = [];

  for (const { p, d } of well) {
    const t = d.getTime();
    if (t <= since || t > now.getTime()) continue;
    const day = dayIndex(d);
    const weekend = isWeekend(d);
    const peers = well.filter(
      (o) => o.d.getHours() === d.getHours() && isWeekend(o.d) === weekend && dayIndex(o.d) < day,
    );
    for (const [metric, field, floor] of FIELDS) {
      const value = p[field];
      if (typeof value !== "number") continue;
      // One value per prior day (the store keeps one point per hour).
      const byDay = new Map<number, number>();
      for (const o of peers) {
        const v = o.p[field];
        if (typeof v === "number") byDay.set(dayIndex(o.d), v);
      }
      if (byDay.size < ANOMALY_MIN_BASELINE_DAYS) continue;
      const base = [...byDay.values()];
      const usual = median(base);
      const spread = MAD_SCALE * median(base.map((x) => Math.abs(x - usual)));
      const diff = value - usual;
      if (Math.abs(diff) <= MAD_K * spread) continue;
      if (Math.abs(diff) < floor) continue;
      if (usual > 0 && Math.abs(diff) / usual < MIN_RELATIVE) continue;
      out.push({
        at: p.t,
        metric,
        value,
        usual,
        baselineDays: byDay.size,
        direction: diff > 0 ? "up" : "down",
        ratio: usual > 0 ? value / usual : Number.POSITIVE_INFINITY,
      });
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
