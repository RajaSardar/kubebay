/**
 * Headroom forecasting (Intelligence roadmap Tier 2 #20, backlog #36 slice 3)
 * over the local usage history. Laptop history only covers the hours the app
 * was open, so the forecast is of the *daily peak during observed hours*, and
 * is gated rather than hidden: it needs FORECAST_MIN_DAYS calendar days, each
 * with at least FORECAST_MIN_HOURS_PER_DAY well-sampled hours. Missing hours
 * are never interpolated, and nothing is projected past the horizon.
 */

/** One hour from `GET /api/history/series` (the engine's history.Point). */
export interface HistoryPoint {
  t: string;
  n: number;
  wellSampled: boolean;
  cpuMean: number | null;
  cpuMax: number | null;
  memMean: number | null;
  memMax: number | null;
  reqCpuMillis: number | null;
  reqMemBytes: number | null;
}

export const FORECAST_MIN_DAYS = 5;
export const FORECAST_MIN_HOURS_PER_DAY = 4;

export type ForecastMetric = "cpuRequests" | "cpuUsage" | "memRequests" | "memUsage";
export type ForecastOutcome = "not-enough-data" | "at-capacity" | "flat-or-falling" | "reaches" | "beyond-horizon";

export interface DailyPeak {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  value: number;
}

export interface MetricForecast {
  metric: ForecastMetric;
  capacity: number;
  outcome: ForecastOutcome;
  /** Qualifying days that have a value for this metric. */
  days: number;
  daysNeeded: number;
  peaks: DailyPeak[];
  slopePerDay: number;
  /** The fitted daily peak on the last qualifying day. */
  latest: number;
  horizonDays: number;
  daysToCapacity: number | null;
}

export interface HeadroomForecast {
  metrics: MetricForecast[];
}

const FIELDS: Record<ForecastMetric, keyof HistoryPoint> = {
  cpuRequests: "reqCpuMillis",
  cpuUsage: "cpuMax",
  memRequests: "reqMemBytes",
  memUsage: "memMax",
};

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Calendar-day index, immune to DST-length days. */
function dayIndex(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function forecastHeadroom(
  points: HistoryPoint[],
  capacity: { cpuMillis: number; memBytes: number },
  opts: { horizonDays?: number } = {},
): HeadroomForecast {
  // Group well-sampled hours by local day; only days with enough of them qualify.
  const byDay = new Map<string, { idx: number; hours: HistoryPoint[] }>();
  for (const p of points) {
    if (!p.wellSampled) continue;
    const d = new Date(p.t);
    const key = dayKey(d);
    const e = byDay.get(key) ?? { idx: dayIndex(d), hours: [] };
    e.hours.push(p);
    byDay.set(key, e);
  }
  const qualifying = [...byDay.entries()]
    .filter(([, e]) => e.hours.length >= FORECAST_MIN_HOURS_PER_DAY)
    .sort((a, b) => a[1].idx - b[1].idx);

  const metrics: MetricForecast[] = [];
  for (const metric of Object.keys(FIELDS) as ForecastMetric[]) {
    const cap = metric.startsWith("cpu") ? capacity.cpuMillis : capacity.memBytes;
    if (!(cap > 0)) continue;
    const field = FIELDS[metric];

    const xs: number[] = [];
    const peaks: DailyPeak[] = [];
    for (const [day, e] of qualifying) {
      const vals = e.hours.map((h) => h[field]).filter((v): v is number => typeof v === "number");
      if (vals.length === 0) continue;
      xs.push(e.idx);
      peaks.push({ day, value: Math.max(...vals) });
    }

    const base = { metric, capacity: cap, days: peaks.length, peaks };
    if (peaks.length < FORECAST_MIN_DAYS) {
      metrics.push({
        ...base,
        outcome: "not-enough-data",
        daysNeeded: FORECAST_MIN_DAYS - peaks.length,
        slopePerDay: 0,
        latest: peaks.at(-1)?.value ?? 0,
        horizonDays: 0,
        daysToCapacity: null,
      });
      continue;
    }

    // Ordinary least squares of daily peak against calendar day.
    const n = xs.length;
    const ys = peaks.map((p) => p.value);
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i]! - mx) * (ys[i]! - my);
      sxx += (xs[i]! - mx) ** 2;
    }
    const slope = sxx === 0 ? 0 : sxy / sxx;
    const lastX = xs[n - 1]!;
    const latest = my + slope * (lastX - mx);
    const horizonDays = opts.horizonDays ?? 2 * (lastX - xs[0]! + 1);

    let outcome: ForecastOutcome;
    let daysToCapacity: number | null = null;
    if (latest >= cap || ys[n - 1]! >= cap) {
      outcome = "at-capacity";
      daysToCapacity = 0;
    } else if (slope <= 0) {
      outcome = "flat-or-falling";
    } else {
      const d = (cap - latest) / slope;
      if (d <= horizonDays) {
        outcome = "reaches";
        daysToCapacity = d;
      } else {
        outcome = "beyond-horizon";
      }
    }
    metrics.push({ ...base, outcome, daysNeeded: 0, slopePerDay: slope, latest, horizonDays, daysToCapacity });
  }
  return { metrics };
}
