/**
 * The maths behind the replica control: the slider's non-linear scale and the preset chips.
 * Pure functions, no React. The slider is a native range over positions 0..POSITION_MAX; the
 * first 40% of the track covers 0..10 one replica at a time (where every step matters), the
 * rest covers 10..max with steps that grow with the size of the track.
 */

/** The native range runs 0..POSITION_MAX; the caller maps a position to a replica count. */
export const POSITION_MAX = 1000;
const LOW_END = 400; // where the 0..10 band ends on the track
const LOW_TOP = 10;

/** Replica count held at 0 or more, whole numbers only. */
export function clampReplicas(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** The smallest 1, 2, 3, 5 × 10^k that is at least `x`. */
function nice(x: number): number {
  let p = 1;
  while (p * 10 < x) p *= 10;
  for (const m of [1, 2, 3, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

/** The smallest 1, 2, 5 × 10^k that is at least `x`. */
function niceStep(x: number): number {
  let p = 1;
  while (p * 10 < x) p *= 10;
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

/**
 * The top of the slider: three times the live count, at least 10, rounded up to a nice number.
 * It follows the live count, never the draft, so the track does not move under the thumb.
 */
export function sliderMax(current: number | undefined): number {
  const c = typeof current === "number" && Number.isFinite(current) ? Math.max(0, current) : 0;
  return nice(Math.max(10, 3 * c));
}

/** The replica count at a slider position. */
export function replicaFromPosition(position: number, max: number): number {
  const p = Math.min(POSITION_MAX, Math.max(0, Math.round(position)));
  if (max <= LOW_TOP) return Math.round((p / POSITION_MAX) * max);
  if (p <= LOW_END) return Math.round((p / LOW_END) * LOW_TOP);
  if (p === POSITION_MAX) return max;
  const span = POSITION_MAX - LOW_END;
  const step = niceStep((max - LOW_TOP) / span);
  const raw = LOW_TOP + ((p - LOW_END) / span) * (max - LOW_TOP);
  return Math.min(max, Math.max(LOW_TOP, Math.round(raw / step) * step));
}

/** The slider position of a replica count; a count above the max pins to the right end. */
export function positionFromReplica(n: number, max: number): number {
  const r = clampReplicas(n);
  if (r >= max) return POSITION_MAX;
  if (max <= LOW_TOP) return Math.round((r / max) * POSITION_MAX);
  if (r <= LOW_TOP) return Math.round((r / LOW_TOP) * LOW_END);
  return LOW_END + Math.round(((r - LOW_TOP) / (max - LOW_TOP)) * (POSITION_MAX - LOW_END));
}

export interface PresetChip {
  value: number;
  label: string;
}

const MAX_CHIPS = 8;

/**
 * One-click counts: 0, 1, 2, 3, 5, 10, half and double the live count, and the live count itself.
 * Deduplicated by value (the most informative label wins), sorted ascending, at most 8; when there
 * are too many the plain numbers farthest from the live count go first, never 0 or Current.
 */
export function presetChips(current: number): PresetChip[] {
  const c = clampReplicas(current);
  const byValue = new Map<number, { label: string; special: boolean }>();
  const put = (value: number, label: string, special: boolean) => {
    if (value < 0 || !Number.isFinite(value)) return;
    const have = byValue.get(value);
    if (!have || (special && !have.special) || (special && have.special && label.startsWith("Current"))) byValue.set(value, { label, special });
  };
  for (const n of [0, 1, 2, 3, 5, 10]) put(n, n === 0 ? "0 (stop)" : String(n), n === 0);
  if (c >= 2) put(Math.round(c / 2), `Half (${Math.round(c / 2)})`, true);
  put(c * 2, `2× (${c * 2})`, true);
  put(c, `Current (${c})`, true);
  let chips = [...byValue].map(([value, v]) => ({ value, ...v }));
  if (chips.length > MAX_CHIPS) {
    const droppable = chips.filter((x) => !x.special).sort((a, b) => Math.abs(b.value - c) - Math.abs(a.value - c));
    const drop = new Set(droppable.slice(0, chips.length - MAX_CHIPS).map((x) => x.value));
    chips = chips.filter((x) => !drop.has(x.value));
  }
  return chips.sort((a, b) => a.value - b.value).map(({ value, label }) => ({ value, label }));
}
