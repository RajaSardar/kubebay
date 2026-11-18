/**
 * Which YAML editors hold edits that were not applied. Every editor reports its
 * own key; the drawers and pages that could drop an editor (close, change tab,
 * navigate) ask `anyEditDirty()` first. Module-level so a host needs no
 * knowledge of which editor sits in it, the same shape as the stream cache.
 */
import { useSyncExternalStore } from "react";

const dirty = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setEditDirty(key: string, isDirty: boolean): void {
  const had = dirty.has(key);
  if (isDirty === had) return;
  if (isDirty) dirty.add(key);
  else dirty.delete(key);
  emit();
}

export function isEditDirty(key: string): boolean {
  return dirty.has(key);
}

export function anyEditDirty(): boolean {
  return dirty.size > 0;
}

/** The keys of every editor that holds unapplied edits. */
export function dirtyEditKeys(): string[] {
  return [...dirty];
}

/** Test helper: forget every report. */
export function resetEditGuard(): void {
  dirty.clear();
  emit();
}

export function useAnyEditDirty(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    anyEditDirty,
    anyEditDirty,
  );
}

/** Whether one editor holds unapplied edits; re-renders when it changes. */
export function useEditDirty(key: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => dirty.has(key),
    () => dirty.has(key),
  );
}
