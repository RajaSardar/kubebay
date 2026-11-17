// Next-run calculation for standard 5-field cron schedules (what a
// Kubernetes CronJob accepts). Pure: no dependency, no clock reads.
//
// Matches the CronJob controller's semantics: when both day-of-month and
// day-of-week are restricted (neither starts with "*"), a day matches if
// EITHER does. Without spec.timeZone the controller runs in the
// kube-controller-manager's local zone, which is UTC on virtually every
// cluster, so UTC is what we assume.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

interface Parsed {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domStar: boolean;
  dowStar: boolean;
}

function parseField(f: string, min: number, max: number, names?: string[], nameBase = 0): Set<number> | null {
  const out = new Set<number>();
  const num = (s: string): number | null => {
    if (names) {
      const i = names.indexOf(s.toLowerCase());
      if (i >= 0) return i + nameBase;
    }
    return /^\d+$/.test(s) ? Number(s) : null;
  };
  for (const part of f.split(",")) {
    const [range, step, extra] = part.split("/");
    if (extra !== undefined || !range) return null;
    let stepN = 1;
    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) < 1) return null;
      stepN = Number(step);
    }
    let lo: number | null;
    let hi: number | null;
    if (range === "*" || range === "?") {
      lo = min;
      hi = max;
    } else if (range.includes("-")) {
      const [a, b, c] = range.split("-");
      if (c !== undefined) return null;
      lo = num(a!);
      hi = num(b!);
    } else {
      lo = num(range);
      hi = step !== undefined ? max : lo;
    }
    if (lo === null || hi === null || lo < min || hi > max || lo > hi) return null;
    for (let i = lo; i <= hi; i += stepN) out.add(i);
  }
  return out;
}

function parse(schedule: string): Parsed | null {
  let s = schedule.trim();
  if (s.startsWith("@")) {
    const m = MACROS[s.toLowerCase()];
    if (!m) return null;
    s = m;
  }
  const f = s.split(/\s+/);
  if (f.length !== 5) return null;
  const minute = parseField(f[0]!, 0, 59);
  const hour = parseField(f[1]!, 0, 23);
  const dom = parseField(f[2]!, 1, 31);
  const month = parseField(f[3]!, 1, 12, MONTHS, 1);
  const dow = parseField(f[4]!, 0, 7, DAYS, 0);
  if (!minute || !hour || !dom || !month || !dow) return null;
  if (dow.has(7)) {
    dow.delete(7);
    dow.add(0);
  }
  const star = (x: string) => x.startsWith("*") || x.startsWith("?");
  return { minute, hour, dom, month, dow, domStar: star(f[2]!), dowStar: star(f[4]!) };
}

/** Offset of `tz` from UTC at instant `t`, in ms. Throws RangeError on an unknown zone. */
function offsetMs(t: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(p.find((x) => x.type === k)!.value);
  const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return local - Math.floor(t / 1000) * 1000;
}

/**
 * The first run strictly after `from`, or null when the schedule or zone is
 * invalid or never fires. `timeZone` is an IANA name; absent means UTC.
 */
export function cronNextRun(schedule: string, from: Date, timeZone?: string): Date | null {
  const c = parse(schedule);
  if (!c) return null;
  const tz = timeZone || "UTC";
  try {
    offsetMs(from.getTime(), tz);
  } catch {
    return null;
  }
  const off = (t: number) => offsetMs(t, tz);
  const start = Math.floor(from.getTime() / 60000) * 60000 + 60000;
  // Walk in "wall clock as UTC" space, then convert back to a real instant.
  let w = new Date(start + off(start));
  const limit = w.getTime() + 9 * 366 * 86400000;
  while (w.getTime() < limit) {
    const mo = w.getUTCMonth() + 1;
    if (!c.month.has(mo)) {
      w = new Date(Date.UTC(w.getUTCFullYear(), mo, 1));
      continue;
    }
    const domOk = c.dom.has(w.getUTCDate());
    const dowOk = c.dow.has(w.getUTCDay());
    const dayOk = !c.domStar && !c.dowStar ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) {
      w = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate() + 1));
      continue;
    }
    if (!c.hour.has(w.getUTCHours())) {
      w = new Date(Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), w.getUTCHours() + 1));
      continue;
    }
    if (!c.minute.has(w.getUTCMinutes())) {
      w = new Date(w.getTime() + 60000);
      continue;
    }
    // Convert wall time back to an instant (two passes settles across a DST edge).
    let t = w.getTime() - off(w.getTime());
    t = w.getTime() - off(t);
    return t > from.getTime() ? new Date(t) : null;
  }
  return null;
}

function rel(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export interface NextRunCell {
  v: string;
  title?: string;
}

/** The CronJobs "Next Schedule" cell: relative time, absolute in the title, an en dash when suspended or invalid. */
export function nextRunCell(o: Record<string, unknown>, now: Date): NextRunCell {
  const spec = (o.spec ?? {}) as Record<string, unknown>;
  if (spec.suspend === true) return { v: "–" };
  const schedule = typeof spec.schedule === "string" ? spec.schedule : "";
  const tz = typeof spec.timeZone === "string" && spec.timeZone ? spec.timeZone : undefined;
  const t = cronNextRun(schedule, now, tz);
  if (!t) return { v: "–" };
  const abs = t.toLocaleString(undefined, { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  return { v: `in ${rel(t.getTime() - now.getTime())}`, title: `${t.toISOString()} (${abs}${tz ? ` ${tz}` : ""})` };
}
