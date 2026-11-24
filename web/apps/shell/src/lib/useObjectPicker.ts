import { useMemo } from "react";
import { buildIndex, mergeGroups, parseQuery, search, type SearchGroup } from "./paletteSearch";
import { usePaletteObjects } from "./usePaletteObjects";
import { usePaletteRemote } from "./usePaletteRemote";

/**
 * The objects of one cluster that match the typed words, grouped by kind: the
 * palette's own search (what the app already follows) joined with the
 * engine's answer for the other kinds. Idle until something is typed.
 */
export function useObjectPicker(cluster: string, q: string): { groups: SearchGroup[]; loading: boolean; error: string } {
  const clusters = useMemo(() => (cluster ? [cluster] : []), [cluster]);
  const objects = usePaletteObjects(!!cluster, clusters);
  const index = useMemo(() => buildIndex(objects), [objects]);
  const local = useMemo(() => (q.trim() ? search(index, q) : []), [index, q]);
  const remote = usePaletteRemote(!!cluster, clusters, q);
  const groups = useMemo(() => {
    const l = remote.filter ? local.filter((g) => g.slug === remote.filter) : local;
    return mergeGroups(l, remote.groups, { listing: parseQuery(q).terms.length === 0 });
  }, [local, remote.groups, remote.filter, q]);
  return { groups, loading: remote.loading || remote.pending.length > 0, error: remote.error };
}
