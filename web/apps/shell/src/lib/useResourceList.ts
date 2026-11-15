import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { compareValues, matchesFilter, useSortPref, useTableKeyboard } from "./tableUx";
import { useTableVirtualizer } from "./useTableVirtualizer";

export interface ResourceListOptions<R> {
  rows: readonly R[];
  /** Stable identity, "namespace/name": selection and React keys. */
  keyOf: (r: R) => string;
  /** The text the filter searches: every word must match one of these. */
  filterFields: (r: R) => string[];
  /** A richer matcher (the key:value filter language); replaces filterFields when set. */
  match?: (r: R, filter: string) => boolean;
  /** Whether a column may order the table now (a hidden one may not). */
  sortable?: (col: string) => boolean;
  /** The value a column sorts by; numbers sort as numbers, text naturally. */
  sortValue: (r: R, col: string) => string | number;
  /** Order when no column is sorted. */
  defaultSort: (a: R, b: R) => number;
  /** Where the chosen sort is remembered ("pods", "r/deployments"). */
  sortKey: string;
  onOpen: (r: R) => void;
  onToggle: (key: string) => void;
  /** Row height estimate for the virtualiser (ROW_HEIGHT[density]). */
  estimate: number;
  scrollRef: RefObject<HTMLElement | null>;
  headerRef: RefObject<HTMLElement | null>;
  /** The filter's text when the list first renders (a link's ?q=). */
  initialFilter?: string;
}

/**
 * Everything a resource list does, apart from what it draws: filter, sort
 * (remembered per table), keyboard navigation (/, j/k, Enter, x, Escape) and
 * the windowed rows under a sticky header. Pass memoised callbacks: the shown
 * rows are recomputed when any of them changes.
 * Plan: docs/TABLE_UNIFICATION.md.
 */
export function useResourceList<R>(o: ResourceListOptions<R>) {
  const { rows, keyOf, filterFields, match, sortable, sortValue, defaultSort, onOpen, onToggle } = o;
  const [filter, setFilter] = useState(o.initialFilter ?? "");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const sort = useSortPref(o.sortKey);

  const shown = useMemo(() => {
    const out = !filter.trim()
      ? [...rows]
      : match
        ? rows.filter((r) => match(r, filter))
        : rows.filter((r) => matchesFilter(filterFields(r), filter));
    if (sort.col && (!sortable || sortable(sort.col))) {
      const col = sort.col;
      out.sort((a, b) => (sort.asc ? compareValues(sortValue(a, col), sortValue(b, col)) : compareValues(sortValue(b, col), sortValue(a, col))));
    } else {
      out.sort(defaultSort);
    }
    return out;
  }, [rows, filter, filterFields, match, sortable, sort.col, sort.asc, sortValue, defaultSort]);

  const allKeys = useMemo(() => shown.map(keyOf), [shown, keyOf]);

  const virtual = useTableVirtualizer({ count: shown.length, estimate: o.estimate, scrollRef: o.scrollRef, headerRef: o.headerRef });

  const { active: activeRow } = useTableKeyboard({
    count: shown.length,
    onOpen: useCallback((i: number) => {
      const r = shown[i];
      if (r !== undefined) onOpen(r);
    }, [shown, onOpen]),
    onToggle: useCallback((i: number) => {
      const k = allKeys[i];
      if (k) onToggle(k);
    }, [allKeys, onToggle]),
    filterRef,
    onClearFilter: useCallback(() => setFilter(""), []),
  });
  const { virtualizer } = virtual;
  useEffect(() => {
    if (activeRow >= 0) virtualizer.scrollToIndex(activeRow, { align: "auto" });
  }, [activeRow, virtualizer]);

  return { shown, filter, setFilter, filterRef, sort, allKeys, activeRow, virtual };
}
