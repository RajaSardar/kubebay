import type { WorkloadHealth } from "./api";
import { reasonInWords } from "./attention";

/** Fewer recorded days than a week say too little about why it keeps breaking. */
const MIN_DAYS = 7;
// Reasons that say something is wrong but not what: naming them as "the"
// reason a workload keeps breaking would mislead more than it helps.
const VAGUE = new Set(["NotReady", "Pending"]);

/**
 * Why a workload keeps breaking, from its recorded week (the 7-day chip): the
 * reason behind at least half its broken hours, the alphabetically first on a
 * tie as the engine picks, once a full week is recorded and never a vague one
 * (NotReady, Pending). Null when the week doesn't say so plainly.
 */
export function chronicReason(h: Pick<WorkloadHealth, "recordedDays" | "brokenHours" | "reasons">): { code: string; plain: string } | null {
  if (h.recordedDays < MIN_DAYS || h.brokenHours === 0 || !h.reasons) return null;
  let code = "";
  let n = 0;
  for (const [c, k] of Object.entries(h.reasons)) {
    if (k > n || (k === n && c < code)) {
      code = c;
      n = k;
    }
  }
  if (!code || VAGUE.has(code) || n * 2 < h.brokenHours) return null;
  return { code, plain: reasonInWords(code) };
}
