import type { AttentionRow } from "./attention";
import type { ClusterCapacity } from "./capacity";

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}

export type VerdictTone = "ok" | "warn" | "err";

export interface HealthVerdict {
  tone: VerdictTone;
  /** The word that sits beside the colour. */
  word: "Healthy" | "Degraded" | "Failing";
  /** One line a manager can paste: the count with its denominator and the worst thing by name. */
  sentence: string;
  /** Workloads needing attention outside the namespaces in scope. */
  outside: number;
}

const WORD: Record<VerdictTone, HealthVerdict["word"]> = { ok: "Healthy", warn: "Degraded", err: "Failing" };

/**
 * Overview v2's verdict: red when something has failed, amber for warnings or
 * a nearly full cluster, green otherwise. With a namespace scope it judges
 * those namespaces and counts what is wrong outside them.
 */
export function healthVerdict(input: {
  attention: AttentionRow[];
  pods: Obj[];
  capacity: ClusterCapacity | null;
  scope?: readonly string[];
}): HealthVerdict {
  const inScope = (ns: string) => !input.scope?.length || input.scope.includes(ns);
  const rows = input.attention.filter((r) => inScope(r.namespace));
  const outside = input.attention.length - rows.length;
  const total = input.pods.filter((p) => {
    const meta = rec(p.metadata);
    return !meta.deletionTimestamp && rec(p.status).phase !== "Succeeded" && inScope(String(meta.namespace ?? ""));
  }).length;

  const full = input.capacity ? [input.capacity.cpu.over && `CPU ${input.capacity.cpu.pct}%`, input.capacity.memory.over && `memory ${input.capacity.memory.pct}%`].filter(Boolean) : [];
  const tone: VerdictTone = rows.some((r) => r.severity === "err") ? "err" : rows.length > 0 || full.length > 0 ? "warn" : "ok";

  const parts: string[] = [];
  if (rows.length === 0) {
    parts.push(`All ${total} pods healthy`);
  } else {
    const broken = rows.reduce((n, r) => n + r.pods.length, 0);
    parts.push(
      broken > 0
        ? `${broken} of ${total} pods need attention`
        : `${rows.length} ${rows.length === 1 ? "workload needs" : "workloads need"} attention`,
    );
    const top = rows[0]!;
    parts.push(`${top.namespace}/${top.name}: ${top.plain}`);
  }
  if (full.length) parts.push(`${full.join(" · ")} requested`);
  return { tone, word: WORD[tone], sentence: parts.join(" · "), outside };
}

const HALF_HOUR = 30 * 60_000;

function eventTime(e: Obj): number {
  const t = Date.parse(String(e.lastTimestamp ?? e.eventTime ?? rec(e.metadata).creationTimestamp ?? ""));
  return Number.isNaN(t) ? NaN : t;
}

/**
 * Whether warnings are rising: the last 30 minutes against the 30 before
 * (events live about an hour, so that is all there is). A change needs to be
 * half again as big and at least 3 events to count. Undefined with no warnings.
 */
export function warningTrend(events: Obj[], now = Date.now()): "worse than 30 min ago" | "better than 30 min ago" | "steady" | undefined {
  let recent = 0;
  let before = 0;
  for (const e of events) {
    if (e.type !== "Warning") continue;
    const t = eventTime(e);
    const n = typeof e.count === "number" && e.count > 0 ? e.count : 1;
    if (t > now - HALF_HOUR && t <= now) recent += n;
    else if (t > now - 2 * HALF_HOUR && t <= now - HALF_HOUR) before += n;
  }
  if (recent === 0 && before === 0) return undefined;
  if (recent >= before * 1.5 && recent - before >= 3) return "worse than 30 min ago";
  if (before >= recent * 1.5 && before - recent >= 3) return "better than 30 min ago";
  return "steady";
}
