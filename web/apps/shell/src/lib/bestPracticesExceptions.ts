import { namespacesOf, offenderNamespace, type BestPracticeCheck } from "./bestPractices";

/** A user's decision to leave a check (or one namespace of it) out of the score. */
export interface BpException {
  checkId: string;
  /** Absent means the whole check. */
  namespace?: string;
  reason: string;
  createdAt: number;
}

const KEY = "kb.bestPractices.exceptions.";

/** Exceptions live in this browser only, one list per cluster. */
export function loadExceptions(cluster: string): BpException[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY + cluster) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter(
      (e): e is BpException =>
        !!e && typeof e === "object" && typeof (e as BpException).checkId === "string" && typeof (e as BpException).reason === "string",
    );
  } catch {
    return [];
  }
}

export function saveExceptions(cluster: string, list: BpException[]): void {
  try {
    if (list.length === 0) localStorage.removeItem(KEY + cluster);
    else localStorage.setItem(KEY + cluster, JSON.stringify(list));
  } catch {
    /* storage unavailable: the exceptions last for this session only */
  }
}

/**
 * Applies exceptions to computed checks. A whole-check exception turns the check
 * into "ignored"; a namespace exception drops that namespace's offenders and
 * ignores the check only when none remain. An ignored check is never a pass.
 */
export function applyExceptions(checks: BestPracticeCheck[], list: BpException[]): BestPracticeCheck[] {
  return checks.map((c) => {
    const mine = list.filter((e) => e.checkId === c.id);
    if (mine.length === 0) return c;
    const whole = mine.find((e) => !e.namespace);
    if (whole) return { ...c, status: "ignored", exceptions: [{ reason: whole.reason }] };
    const nsEx = mine.filter((e) => e.namespace);
    if (c.status !== "fail" || !c.allOffenders) return c;
    const skip = new Map(nsEx.map((e) => [e.namespace!, e.reason]));
    const remaining = c.allOffenders.filter((o) => !skip.has(offenderNamespace(c.id, o)));
    if (remaining.length === c.allOffenders.length) return c;
    const exceptions = nsEx
      .filter((e) => c.allOffenders!.some((o) => offenderNamespace(c.id, o) === e.namespace))
      .map((e) => ({ namespace: e.namespace, reason: e.reason }));
    if (remaining.length === 0) return { ...c, status: "ignored", offenders: [], allOffenders: [], namespaces: [], exceptions };
    return {
      ...c,
      detail: c.detail.replace(/^\d+/, String(remaining.length)),
      offenders: remaining.slice(0, 3),
      allOffenders: remaining,
      namespaces: namespacesOf(c.id, remaining),
      exceptions,
    };
  });
}
