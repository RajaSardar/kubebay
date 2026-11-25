import { ISSUE_SEVERITIES, type Issue, type IssueSeverity } from "./issues";

/**
 * Backlog 85: which new Issues become an OS notification. Pure: no React, no
 * Tauri, no fetches, and an injected clock. The rules, in one place:
 *  - off by default; a severity threshold (default Critical only);
 *  - per-cluster mute;
 *  - quiet while the Kubebay window is focused;
 *  - issues present when Kubebay starts (or a cluster is opened) are the
 *    baseline and never notify, only ones that appear after it;
 *  - at most one notification per issue per 6 hours;
 *  - at most 3 a minute, after which the rest fold into one "N new issues"
 *    summary (itself at most one a minute); what is held is sent later if it
 *    is still there.
 * The text carries the kind, namespace/name and severity only: never the
 * detector's summary line, never anything read from a pod or Secret.
 */

export interface NotifySettings {
  enabled: boolean;
  /** Notify for issues at least this severe. */
  minSeverity: IssueSeverity;
  mutedClusters: string[];
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = { enabled: false, minSeverity: "critical", mutedClusters: [] };

const KEY = "kb.issueNotifications";

export function loadNotifySettings(): NotifySettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<NotifySettings> | null;
    if (
      v &&
      typeof v.enabled === "boolean" &&
      ISSUE_SEVERITIES.includes(v.minSeverity as IssueSeverity) &&
      Array.isArray(v.mutedClusters) &&
      v.mutedClusters.every((c) => typeof c === "string")
    ) {
      return { enabled: v.enabled, minSeverity: v.minSeverity as IssueSeverity, mutedClusters: v.mutedClusters };
    }
  } catch {
    /* fall through to the defaults */
  }
  return { ...DEFAULT_NOTIFY_SETTINGS, mutedClusters: [] };
}

export const NOTIFY_SETTINGS_EVENT = "kb:issue-notify-settings";

export function saveNotifySettings(s: NotifySettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
  window.dispatchEvent(new Event(NOTIFY_SETTINGS_EVENT));
}

export interface IssueNotification {
  title: string;
  body: string;
  /** Absent on the "N new issues" summary. */
  issueId?: string;
}

export const DEDUPE_MS = 6 * 3600_000;
export const WINDOW_MS = 60_000;
export const MAX_PER_WINDOW = 3;
/** How soon after a notification a window focus counts as clicking it. */
export const CLICK_WITHIN_MS = 2 * 60_000;

const RANK: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function describe(i: Issue): IssueNotification {
  return { title: `${cap(i.severity)} issue`, body: `${i.kind} ${i.namespace ? `${i.namespace}/` : ""}${i.name}`, issueId: i.id };
}

export interface Observation {
  cluster: string;
  issues: Issue[];
  /** Some detector has not answered yet: what is here is still the start-up baseline. */
  loading: boolean;
  focused: boolean;
  settings: NotifySettings;
}

interface ClusterState {
  known: Set<string>;
  baselined: boolean;
  /** New issues waiting for a rate-limit slot. */
  held: Map<string, Issue>;
}

export function createIssueNotifier(now: () => number) {
  let state: { cluster: string; s: ClusterState } | null = null;
  const lastNotified = new Map<string, number>();
  let sent: number[] = [];
  let lastSummary = -Infinity;

  function observe(o: Observation): IssueNotification[] {
    // One cluster is watched at a time; opening another starts its own baseline.
    if (!state || state.cluster !== o.cluster) state = { cluster: o.cluster, s: { known: new Set(), baselined: false, held: new Map() } };
    const st = state.s;
    const ids = new Set(o.issues.map((i) => i.id));
    const fresh = o.issues.filter((i) => !st.known.has(i.id));
    // A list that is still loading (a dropped connection returns an empty one)
    // is not news: keep what was known so the refill is not mistaken for new issues.
    st.known = o.loading ? new Set([...st.known, ...ids]) : ids;
    if (!st.baselined) {
      if (!o.loading) st.baselined = true;
      return [];
    }
    if (o.loading) return [];
    for (const id of st.held.keys()) if (!ids.has(id)) st.held.delete(id);

    const t = now();
    const quiet = !o.settings.enabled || o.settings.mutedClusters.includes(o.cluster) || o.focused;
    if (quiet) {
      st.held.clear();
      return [];
    }
    const wanted = (i: Issue) => RANK[i.severity] <= RANK[o.settings.minSeverity];
    for (const i of fresh) if (wanted(i)) st.held.set(i.id, i);
    for (const [id, i] of st.held) if (!wanted(i)) st.held.delete(id);

    const due = [...st.held.values()]
      .filter((i) => {
        const at = lastNotified.get(i.id);
        return at === undefined || t - at >= DEDUPE_MS;
      })
      .sort((a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id));
    for (const i of st.held.values()) if (!due.includes(i)) st.held.delete(i.id); // notified within 6h

    sent = sent.filter((at) => t - at < WINDOW_MS);
    const room = MAX_PER_WINDOW - sent.length;
    const out: IssueNotification[] = [];
    if (due.length <= room) {
      for (const i of due) out.push(describe(i));
      for (const i of due) {
        lastNotified.set(i.id, t);
        st.held.delete(i.id);
        sent.push(t);
      }
      return out;
    }
    const singles = due.slice(0, Math.max(0, room));
    const rest = due.slice(singles.length);
    for (const i of singles) {
      out.push(describe(i));
      lastNotified.set(i.id, t);
      st.held.delete(i.id);
      sent.push(t);
    }
    if (t - lastSummary >= WINDOW_MS) {
      out.push({ title: `${rest.length} new ${rest.length === 1 ? "issue" : "issues"}`, body: "Open Kubebay to see them." });
      lastSummary = t;
      for (const i of rest) {
        lastNotified.set(i.id, t);
        st.held.delete(i.id);
      }
    }
    return out;
  }

  return { observe };
}

/**
 * The page a window focus should open. The desktop notification plugin cannot
 * report a click on a desktop OS, but clicking one brings Kubebay forward, so a
 * focus soon after a notification is treated as the click.
 */
export function clickTarget(last: { at: number; issueId?: string } | null, nowMs: number): string | null {
  if (!last || nowMs - last.at > CLICK_WITHIN_MS) return null;
  return last.issueId ? `/issues?issue=${encodeURIComponent(last.issueId)}` : "/issues";
}

const CLAIM_KEY = "kb.issueNotifyClaims";

/**
 * Several windows of the desktop app share this storage and each runs a
 * watcher; the first to claim a notification shows it, the others skip it. An
 * issue is claimed for 6 hours, the "N new issues" summary for a minute.
 */
export function claimNotification(n: IssueNotification, nowMs: number): boolean {
  const id = n.issueId ?? "\u0000summary";
  const ttl = n.issueId ? DEDUPE_MS : WINDOW_MS;
  try {
    const all = (JSON.parse(localStorage.getItem(CLAIM_KEY) ?? "{}") ?? {}) as Record<string, number>;
    const live: Record<string, number> = {};
    for (const [k, at] of Object.entries(all)) if (typeof at === "number" && nowMs - at < (k === "\u0000summary" ? WINDOW_MS : DEDUPE_MS)) live[k] = at;
    const prev = live[id];
    if (prev !== undefined && nowMs - prev < ttl) return false;
    live[id] = nowMs;
    localStorage.setItem(CLAIM_KEY, JSON.stringify(live));
  } catch {
    /* storage unavailable: show it rather than lose it */
  }
  return true;
}
