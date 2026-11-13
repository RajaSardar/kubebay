/**
 * The ⌘K palette's object search: pure functions over a list of objects the
 * app already holds, so searching opens no stream of its own.
 *
 * A query is words. A first word that names a kind, followed by a space or a
 * colon (`deploy api`, `pod:web`, `ns:`), limits the search to that kind;
 * every other word must match the object's name or namespace.
 */
import { DEFS, EXTRA_DEFS } from "./resources";

export interface SearchObject {
  cluster: string;
  /** The resource slug: "pods", "deployments", ... (the key of DEFS). */
  slug: string;
  /** "" for a cluster-scoped object. */
  ns: string;
  name: string;
  /** The live row this came from, kept by reference so a hit can show its status. */
  row?: Record<string, unknown>;
}

export interface SearchHit {
  obj: SearchObject;
  score: number;
}

export interface SearchGroup {
  slug: string;
  label: string;
  /** Every match, not just the rows returned. */
  total: number;
  hits: SearchHit[];
}

interface Indexed {
  obj: SearchObject;
  nameL: string;
  nsL: string;
  fullL: string;
}

export interface Index {
  items: Indexed[];
}

// The kinds the app follows in the background for every connected cluster, in
// the order ties between groups are broken, with the words that name them.
const KINDS: { slug: string; aliases: string[] }[] = [
  { slug: "pods", aliases: ["pod", "pods", "po"] },
  { slug: "deployments", aliases: ["deployment", "deployments", "deploy", "dep"] },
  { slug: "statefulsets", aliases: ["statefulset", "statefulsets", "sts"] },
  { slug: "daemonsets", aliases: ["daemonset", "daemonsets", "ds"] },
  { slug: "jobs", aliases: ["job", "jobs"] },
  { slug: "nodes", aliases: ["node", "nodes", "no"] },
  { slug: "namespaces", aliases: ["namespace", "namespaces", "ns"] },
];

const ALIASES = new Map(KINDS.flatMap((k) => k.aliases.map((a) => [a, k.slug] as const)));
const KIND_ORDER = new Map(KINDS.map((k, i) => [k.slug, i] as const));

function labelOf(slug: string): string {
  return DEFS[slug]?.label ?? EXTRA_DEFS[slug]?.label ?? slug;
}

export function buildIndex(objs: SearchObject[]): Index {
  return {
    items: objs.map((obj) => {
      const nameL = obj.name.toLowerCase();
      const nsL = obj.ns.toLowerCase();
      return { obj, nameL, nsL, fullL: `${nsL}/${nameL}` };
    }),
  };
}

export function parseQuery(raw: string): { slug: string | null; terms: string[] } {
  const tokens = raw.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const first = tokens[0];
  if (!first) return { slug: null, terms: [] };

  const colon = first.indexOf(":");
  if (colon > 0) {
    const slug = ALIASES.get(first.slice(0, colon));
    if (slug) {
      const rest = first.slice(colon + 1);
      return { slug, terms: [...(rest ? [rest] : []), ...tokens.slice(1)] };
    }
  } else {
    const slug = ALIASES.get(first);
    // A lone word stays a search term until a space says it was a kind.
    if (slug && (tokens.length > 1 || /\s$/.test(raw))) return { slug, terms: tokens.slice(1) };
  }
  return { slug: null, terms: tokens };
}

function inOrder(hay: string, needle: string): boolean {
  let j = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) if (hay[i] === needle[j]) j++;
  return j === needle.length;
}

// exact name > name prefix > start of a word in the name > anywhere in the
// name > the namespace > the letters in order.
function scoreTerm(it: Indexed, t: string): number {
  if (t.includes("/")) {
    const i = it.fullL.indexOf(t);
    return i === 0 ? 85 : i > 0 ? 55 : 0;
  }
  const n = it.nameL;
  if (n === t) return 100;
  const i = n.indexOf(t);
  if (i === 0) return 90;
  if (i > 0) {
    const p = n.charCodeAt(i - 1);
    return p === 45 || p === 46 || p === 95 ? 70 : 55; // - . _
  }
  if (it.nsL === t) return 35;
  if (it.nsL.includes(t)) return 25;
  return inOrder(n, t) ? 12 : 0;
}

function scoreAll(it: Indexed, terms: string[]): number {
  if (terms.length === 0) return 1;
  let sum = 0;
  for (const t of terms) {
    const s = scoreTerm(it, t);
    if (s === 0) return 0;
    sum += s;
  }
  return Math.round(sum / terms.length);
}

export function search(index: Index, raw: string, opts: { perGroup?: number; maxGroups?: number } = {}): SearchGroup[] {
  const { slug, terms } = parseQuery(raw);
  if (!slug && terms.length === 0) return [];
  const listing = terms.length === 0;
  const perGroup = opts.perGroup ?? (listing ? 25 : 5);
  const maxGroups = opts.maxGroups ?? 7;

  const buckets = new Map<string, SearchHit[]>();
  for (const it of index.items) {
    if (slug && it.obj.slug !== slug) continue;
    const score = scoreAll(it, terms);
    if (score === 0) continue;
    const list = buckets.get(it.obj.slug);
    if (list) list.push({ obj: it.obj, score });
    else buckets.set(it.obj.slug, [{ obj: it.obj, score }]);
  }

  const groups: SearchGroup[] = [];
  for (const [s, hits] of buckets) {
    hits.sort((a, b) =>
      listing
        ? a.obj.name.localeCompare(b.obj.name) || a.obj.ns.localeCompare(b.obj.ns)
        : b.score - a.score ||
          a.obj.name.length - b.obj.name.length ||
          a.obj.name.localeCompare(b.obj.name) ||
          a.obj.ns.localeCompare(b.obj.ns),
    );
    groups.push({ slug: s, label: labelOf(s), total: hits.length, hits: hits.slice(0, perGroup) });
  }

  groups.sort(
    (a, b) =>
      (b.hits[0]?.score ?? 0) - (a.hits[0]?.score ?? 0) || (KIND_ORDER.get(a.slug) ?? 99) - (KIND_ORDER.get(b.slug) ?? 99),
  );
  return groups.slice(0, maxGroups);
}
