export interface WarningEventForHeat {
  /** Last occurrence, ms epoch (Event's lastTimestamp/eventTime). */
  ts: number;
  /** First occurrence, ms epoch (Event's firstTimestamp). Falls back to ts. */
  firstTs?: number;
  count: number;
}

export interface HeatBucket {
  start: number;
  end: number;
  value: number;
}

// The API server's default --event-ttl is 1h, so events older than that are
// already gone from the stream — showing a 24h axis would be dishonest.
export const HEAT_STRIP_WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_BUCKET_COUNT = 30;

// Bounds the work done for one pathological event (a huge `count`) — the
// strip is an intensity display, not an exact count, so sampling is fine.
const MAX_SAMPLES_PER_EVENT = 200;

/**
 * Buckets warning events into a fixed time window, spreading each event's
 * `count` across its own firstTimestamp..lastTimestamp span rather than
 * dumping the whole count into the "last seen" bucket — a flapping event
 * that fired 50 times over the last 40 minutes should look like 40 minutes
 * of flapping, not one 2-minute spike.
 */
export function buildWarningHeatStrip(
  events: WarningEventForHeat[],
  opts: { now?: number; windowMs?: number; bucketCount?: number } = {},
): HeatBucket[] {
  const now = opts.now ?? Date.now();
  const windowMs = opts.windowMs ?? HEAT_STRIP_WINDOW_MS;
  const bucketCount = opts.bucketCount ?? DEFAULT_BUCKET_COUNT;
  const bucketMs = windowMs / bucketCount;
  const windowStart = now - windowMs;

  const buckets: HeatBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    start: windowStart + i * bucketMs,
    end: windowStart + (i + 1) * bucketMs,
    value: 0,
  }));

  const bucketIndexFor = (t: number): number | null => {
    if (t < windowStart || t > now) return null;
    // The window's own upper edge (t === now) falls exactly on the boundary
    // between the last bucket and a nonexistent one past it — inclusive to
    // the last bucket, or a sample landing exactly at "now" is silently lost.
    const idx = Math.min(Math.floor((t - windowStart) / bucketMs), bucketCount - 1);
    return idx >= 0 ? idx : null;
  };

  for (const e of events) {
    const last = Math.min(e.ts, now);
    const first = e.firstTs !== undefined && e.firstTs <= e.ts ? e.firstTs : e.ts;
    const spanStart = Math.max(first, windowStart);
    const spanEnd = last;
    if (spanEnd < windowStart) continue; // entirely outside the window

    const count = e.count > 0 ? e.count : 1;
    if (spanEnd <= spanStart || count === 1) {
      const idx = bucketIndexFor(spanEnd);
      if (idx !== null) buckets[idx]!.value += count;
      continue;
    }

    const samples = Math.min(count, MAX_SAMPLES_PER_EVENT);
    const weight = count / samples;
    const step = samples > 1 ? (spanEnd - spanStart) / (samples - 1) : 0;
    for (let i = 0; i < samples; i++) {
      const idx = bucketIndexFor(spanStart + i * step);
      if (idx !== null) buckets[idx]!.value += weight;
    }
  }

  return buckets;
}
