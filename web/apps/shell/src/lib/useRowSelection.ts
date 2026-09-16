import { useCallback, useState } from "react";

/**
 * Manages a set of selected row keys.
 * Designed for tables where each row has a unique string key (e.g. "ns/name").
 */
export function useRowSelection() {
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(
    new Set<string>()
  );

  /** Toggle a single key in/out of the selection. */
  const toggleRow = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /** Replace the selection with exactly these keys. */
  const selectAll = useCallback((keys: string[]) => {
    setSelectedKeys(new Set(keys));
  }, []);

  /** Empty the selection. */
  const clearAll = useCallback(() => {
    setSelectedKeys(new Set<string>());
  }, []);

  /** Remove specific keys from the selection (e.g. after those rows were deleted). */
  const deselect = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  /** True when keys is non-empty and every key is selected. */
  const isAllSelected = useCallback(
    (keys: string[]) =>
      keys.length > 0 && keys.every((k) => selectedKeys.has(k)),
    [selectedKeys]
  );

  /** True when at least one — but not all — keys are selected. */
  const isIndeterminate = useCallback(
    (keys: string[]) => {
      if (keys.length === 0) return false;
      const count = keys.filter((k) => selectedKeys.has(k)).length;
      return count > 0 && count < keys.length;
    },
    [selectedKeys]
  );

  return {
    selectedKeys,
    toggleRow,
    selectAll,
    clearAll,
    deselect,
    isAllSelected,
    isIndeterminate,
  };
}
