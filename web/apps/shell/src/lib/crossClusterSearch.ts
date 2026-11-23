/**
 * Cross-cluster search: the pure parts of the Search all clusters page. The
 * connected clusters are searched from what the app holds and the engine's
 * index; the clusters that aren't connected are searched only when the user
 * asks, by the engine, without connecting them.
 */
import type { ClusterInfo, ColdHit, ColdSearchResponse } from "./api";
import { hitOrder, type SearchGroup, type SearchHit } from "./paletteSearch";

/** The most clusters the engine searches in one request (fleet.MaxPerRequest). */
export const MAX_COLD_IDS = 200;
/** The most results the page lists. */
export const MAX_RESULTS = 200;

export interface CrossClusterRow {
  cluster: string;
  slug: string;
  /** The kind's plural label, e.g. "Deployments". */
  kind: string;
  ns: string;
  name: string;
  score: number;
  /** Found in a connected cluster (opening it is instant). */
  connected: boolean;
}

/** The clusters to search on request: not connected, able to build a client, not hidden. */
export function coldTargets(list: ClusterInfo[], connected: Set<string>, meta: Record<string, { hidden?: boolean } | undefined>): string[] {
  return list
    .filter((c) => !connected.has(c.id) && c.status !== "misconfigured" && !meta[c.id]?.hidden)
    .map((c) => c.id)
    .slice(0, MAX_COLD_IDS);
}

/**
 * Joins the connected clusters' groups and the disconnected clusters' hits into
 * one ranked list, an object once, capped at MAX_RESULTS. `total` counts every
 * match, including those beyond the cap.
 */
export function crossClusterRows(
  warm: SearchGroup[],
  cold: ColdHit[],
  opts: { listing: boolean; coldTotal?: number },
): { rows: CrossClusterRow[]; total: number; capped: boolean } {
  const seen = new Set<string>();
  const rows: (CrossClusterRow & SearchHit)[] = [];
  let total = 0;
  let dupes = 0;
  const add = (r: CrossClusterRow) => {
    const key = `${r.cluster}\0${r.slug}\0${r.ns}\0${r.name}`;
    if (seen.has(key)) {
      dupes++;
      return;
    }
    seen.add(key);
    rows.push({ ...r, obj: { cluster: r.cluster, slug: r.slug, ns: r.ns, name: r.name } });
  };
  for (const g of warm) {
    total += g.total;
    for (const h of g.hits) add({ cluster: h.obj.cluster, slug: g.slug, kind: g.label, ns: h.obj.ns, name: h.obj.name, score: h.score, connected: true });
  }
  total += Math.max(opts.coldTotal ?? 0, cold.length);
  for (const h of cold) add({ cluster: h.cluster, slug: h.slug, kind: h.kind, ns: h.ns, name: h.name, score: h.score, connected: false });
  rows.sort(hitOrder(opts.listing));
  total -= dupes;
  const out = rows.slice(0, MAX_RESULTS).map(({ obj: _obj, ...r }) => r);
  return { rows: out, total, capped: total > out.length };
}

export interface ColdNote {
  key: string;
  tone: "err" | "warn" | "info";
  text: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What the page says about the disconnected clusters' search: failures, access, what's still running. */
export function coldNotes(res: ColdSearchResponse, nameOf: (id: string) => string): ColdNote[] {
  const notes: ColdNote[] = [];
  if (res.unsupported) notes.push({ key: "unsupported", tone: "info", text: res.unsupported });
  const pending = res.clusters.filter((c) => c.pending).length;
  for (const c of res.clusters) {
    if (c.error) notes.push({ key: `error:${c.id}`, tone: "err", text: `${nameOf(c.id)}: couldn't search it. ${c.error}` });
    for (const d of c.denied ?? [])
      notes.push({ key: `denied:${c.id}:${d.label}`, tone: "warn", text: `${nameOf(c.id)}: your access can't list ${d.label}. ${d.reason}` });
  }
  if (pending > 0) notes.push({ key: "pending", tone: "info", text: `Still searching ${plural(pending, "cluster")}. More may appear.` });
  for (const c of res.clusters)
    for (const k of c.truncated ?? []) notes.push({ key: `truncated:${c.id}:${k}`, tone: "info", text: `${nameOf(c.id)}: too many ${k} to search them all.` });
  return notes;
}
