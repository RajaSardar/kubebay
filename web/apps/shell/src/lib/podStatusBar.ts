import type { StatusTone } from "@kubebay/ui";
import { derivePod, type PodRow } from "./pods";

export interface PodStatusSegment {
  /** The status word the Pods table shows (Running, CrashLoopBackOff). */
  label: string;
  count: number;
  tone: StatusTone;
  /** The Pods page filtered to this word. */
  to: string;
}

const TONE: Record<PodRow["status"], StatusTone> = { running: "ok", succeeded: "terminated", pending: "pending", failed: "err", warning: "warn" };
// Healthy and in-between states first, in this order; failures after, largest first.
const ORDER = ["Running", "Pending", "Terminating", "Succeeded"];

/**
 * Overview v2's pod status bar: one segment per status word the Pods table
 * shows, each with its count and the filtered Pods list it opens.
 */
export function podStatusSegments(pods: Record<string, unknown>[]): PodStatusSegment[] {
  const by = new Map<string, PodStatusSegment>();
  for (const obj of pods) {
    const p = derivePod(obj);
    if (!p) continue;
    const label = p.statusLabel;
    const seg = by.get(label);
    if (seg) seg.count++;
    else {
      const tone: StatusTone = label === "Terminating" ? "terminating" : TONE[p.status];
      by.set(label, { label, count: 1, tone, to: `/workloads?${new URLSearchParams({ q: `status:${label}` }).toString()}` });
    }
  }
  const rank = (s: PodStatusSegment) => {
    const i = ORDER.indexOf(s.label);
    return i >= 0 ? i : ORDER.length;
  };
  return [...by.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.label.localeCompare(b.label));
}
