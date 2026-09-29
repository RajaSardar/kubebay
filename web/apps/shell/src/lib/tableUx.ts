import { useCallback, useEffect, useState, type RefObject } from "react";

/** A row passes when every word of the query appears in one of its fields, ignoring case. */
export function matchesFilter(fields: readonly string[], query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.map((f) => f.toLowerCase());
  return words.every((w) => hay.some((f) => f.includes(w)));
}

/** The row count for a table header: "12", or "3 of 340" when a filter hides some. */
export function countLabel(shown: number, total: number): string {
  return shown === total ? String(shown) : `${shown} of ${total}`;
}

/** An exact local timestamp for the tooltip on a relative age ("3d"). */
export function absoluteTime(ts: string | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" });
}

const SORT_KEY = (table: string) => `kb.sort.${table}`;

/** A table's sort column and direction, remembered per table across visits. */
export function useSortPref(table: string) {
  const read = () => {
    try {
      const v = JSON.parse(localStorage.getItem(SORT_KEY(table)) ?? "null") as { col: string | null; asc: boolean } | null;
      if (v && (typeof v.col === "string" || v.col === null) && typeof v.asc === "boolean") return v;
    } catch {
      /* fall through */
    }
    return { col: null as string | null, asc: true };
  };
  const [state, setState] = useState(read);
  // A different table (the resource route changed) reads its own preference.
  useEffect(() => setState(read()), [table]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(
    (col: string) => {
      setState((s) => {
        const next = s.col === col ? { col, asc: !s.asc } : { col, asc: true };
        try {
          localStorage.setItem(SORT_KEY(table), JSON.stringify(next));
        } catch {
          /* storage unavailable: keep it for this visit */
        }
        return next;
      });
    },
    [table],
  );
  return { col: state.col, asc: state.asc, toggle };
}

const TYPING = "input, textarea, select, [contenteditable='true'], .xterm, .monaco-editor";

export interface TableKeyboardOptions {
  count: number;
  onOpen: (index: number) => void;
  onToggle: (index: number) => void;
  filterRef: RefObject<HTMLInputElement | null>;
  onClearFilter: () => void;
}

/**
 * Keyboard use of a list, as in Linear and GitHub: ↑/↓ or j/k move the active
 * row, Enter opens it, x selects it, / jumps to the filter and Escape in the
 * filter clears it. Keys typed into a field, and keys with modifiers, are left
 * alone.
 */
export function useTableKeyboard({ count, onOpen, onToggle, filterRef, onClearFilter }: TableKeyboardOptions) {
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (active >= count) setActive(count - 1);
  }, [count, active]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && target === filterRef.current && e.key === "Escape") {
        onClearFilter();
        filterRef.current?.blur();
        return;
      }
      if (target?.closest?.(TYPING)) return;
      // A dialog or drawer owns the keyboard while it is open.
      if (target?.closest?.(".drawer, .kb-modal")) return;
      switch (e.key) {
        case "/":
          e.preventDefault();
          filterRef.current?.focus();
          return;
        case "ArrowDown":
        case "j":
          if (count === 0) return;
          e.preventDefault();
          setActive((a) => Math.min(count - 1, a + 1));
          return;
        case "ArrowUp":
        case "k":
          if (count === 0) return;
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
          return;
        case "Enter":
          if (active >= 0) {
            e.preventDefault();
            onOpen(active);
          }
          return;
        case "x":
          if (active >= 0) {
            e.preventDefault();
            onToggle(active);
          }
          return;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, active, onOpen, onToggle, filterRef, onClearFilter]);

  return { active, setActive };
}
