/**
 * Which clusters the ⌘K palette offers to switch to, for what was typed.
 * Pure: the palette hands in the cluster list, the saved aliases and the
 * current cluster.
 */
import type { ClusterInfo } from "./api";
import { clusterDisplayName } from "./clusterDistro";

export interface ClusterMeta {
  alias?: string;
  pinned?: boolean;
  hidden?: boolean;
  lastUsed?: number;
}

export interface ClusterChoice {
  id: string;
  /** What the Clusters page calls it: the alias, else a name read from the context. */
  name: string;
  context: string;
  status: ClusterInfo["status"];
  connected: boolean;
  current: boolean;
  /** A cluster whose kubeconfig is broken can't be opened; the Clusters page says why. */
  usable: boolean;
  pinned: boolean;
  lastUsed: number;
}

export function clusterChoices(clusters: ClusterInfo[], meta: Record<string, ClusterMeta>, active: string): ClusterChoice[] {
  return clusters
    .filter((c) => !meta[c.id]?.hidden)
    .map((c) => ({
      id: c.id,
      name: clusterDisplayName(c.id, c.context, meta[c.id]?.alias),
      context: c.context,
      status: c.status,
      connected: !!c.connected,
      current: c.id === active,
      usable: c.status !== "misconfigured",
      pinned: !!meta[c.id]?.pinned,
      lastUsed: meta[c.id]?.lastUsed ?? 0,
    }));
}

// Words that mean "I'm looking for a cluster", when followed by a space or colon.
const INTENT = new Set(["switch", "sw", "cluster", "clusters", "ctx", "context", "use"]);

function parse(raw: string): { intent: boolean; terms: string[] } {
  const lower = raw.toLowerCase();
  const trimmed = lower.trim();
  if (trimmed.startsWith("@")) return { intent: true, terms: trimmed.slice(1).split(/\s+/).filter(Boolean) };
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const first = tokens[0];
  if (!first) return { intent: false, terms: [] };
  const colon = first.indexOf(":");
  if (colon > 0 && INTENT.has(first.slice(0, colon))) {
    const rest = first.slice(colon + 1);
    return { intent: true, terms: [...(rest ? [rest] : []), ...tokens.slice(1)] };
  }
  if (INTENT.has(first) && (tokens.length > 1 || /\s$/.test(lower))) return { intent: true, terms: tokens.slice(1) };
  return { intent: false, terms: tokens };
}

// Pinned first, then most recently used, then by name.
const byUse = (a: ClusterChoice, b: ClusterChoice) =>
  Number(b.pinned) - Number(a.pinned) || b.lastUsed - a.lastUsed || a.name.localeCompare(b.name);

function rank(c: ClusterChoice, terms: string[]): number {
  let total = 0;
  for (const t of terms) {
    const name = c.name.toLowerCase();
    const id = c.id.toLowerCase();
    const ctx = c.context.toLowerCase();
    if (name.startsWith(t) || id.startsWith(t)) total += 0;
    else if (name.includes(t) || id.includes(t)) total += 1;
    else if (ctx.includes(t)) total += 2;
    else return -1;
  }
  return total;
}

/**
 * `intent` is true when the words said "a cluster" (switch, ctx, @...), so the
 * palette can put them first. Without it, only a real match of two or more
 * letters shows, and an empty box offers the ones you used most recently.
 */
export function matchClusters(choices: ClusterChoice[], raw: string, max: number): { intent: boolean; list: ClusterChoice[] } {
  const { intent, terms } = parse(raw);
  const others = choices.filter((c) => !c.current);
  if (terms.length === 0) {
    if (!intent && raw.trim() !== "") return { intent, list: [] };
    return { intent, list: [...others].sort(byUse).slice(0, max) };
  }
  if (!intent && terms.join(" ").length < 2) return { intent, list: [] };
  const ranked = others
    .map((c) => ({ c, r: rank(c, terms) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || byUse(a.c, b.c))
    .map((x) => x.c);
  return { intent, list: ranked.slice(0, max) };
}
