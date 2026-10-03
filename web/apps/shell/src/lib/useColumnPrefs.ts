import { useCallback, useEffect, useMemo, useState } from "react";

export interface ColumnDefault {
  id: string;
  /** Hidden until the user shows it. */
  defaultHidden?: boolean;
}

interface Saved {
  v: 1;
  order: string[];
  hidden: string[];
}

const KEY = (table: string) => `kb.cols.${table}`;

function load(table: string): Saved | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY(table)) ?? "null") as Saved | null;
    if (v && v.v === 1 && Array.isArray(v.order) && Array.isArray(v.hidden)) return v;
  } catch {
    /* unreadable: use the page's layout */
  }
  return null;
}

function store(table: string, s: Saved | null) {
  try {
    if (s) localStorage.setItem(KEY(table), JSON.stringify(s));
    else localStorage.removeItem(KEY(table));
  } catch {
    /* storage unavailable: keep it for this visit */
  }
}

/**
 * Which of a table's columns show, and in what order, remembered per table
 * under `kb.cols.<table>` (docs/TABLE_FOLLOWUPS.md, #21). Columns that appear
 * later (CRD printer columns) join at the end; saved ids that no longer exist
 * are ignored. Name is not managed here: it is always first and always shown.
 */
export function useColumnPrefs(table: string, columns: readonly ColumnDefault[]) {
  const [saved, setSaved] = useState<Saved | null>(() => load(table));
  // A different table (the resource route changed) reads its own layout.
  useEffect(() => setSaved(load(table)), [table]);

  const ids = useMemo(() => columns.map((c) => c.id), [columns]);
  const idKey = ids.join("\u0000");
  const order = useMemo(() => {
    if (!saved) return ids;
    const known = new Set(ids);
    const kept = saved.order.filter((id) => known.has(id));
    return [...kept, ...ids.filter((id) => !kept.includes(id))];
  }, [saved, idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const hidden = useMemo(
    () => new Set(saved ? saved.hidden : columns.filter((c) => c.defaultHidden).map((c) => c.id)),
    [saved, columns],
  );
  const visible = useMemo(() => order.filter((id) => !hidden.has(id)), [order, hidden]);

  const commit = useCallback(
    (next: Saved) => {
      setSaved(next);
      store(table, next);
    },
    [table],
  );

  const toggle = useCallback(
    (id: string) => {
      const h = new Set(hidden);
      if (h.has(id)) h.delete(id);
      else h.add(id);
      commit({ v: 1, order, hidden: [...h] });
    },
    [hidden, order, commit],
  );

  const move = useCallback(
    (id: string, by: -1 | 1) => {
      const i = order.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= order.length) return;
      const next = [...order];
      [next[i], next[j]] = [next[j]!, next[i]!];
      commit({ v: 1, order: next, hidden: [...hidden] });
    },
    [order, hidden, commit],
  );

  const reset = useCallback(() => {
    setSaved(null);
    store(table, null);
  }, [table]);

  return { order, hidden, visible, toggle, move, reset };
}
