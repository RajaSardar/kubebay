import { useCallback, useState } from "react";

/** A boolean kept in localStorage under `key`, so a section stays as the user left it. */
export function usePersistedFlag(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v === "1";
    } catch {
      return fallback;
    }
  });
  const toggle = useCallback(() => {
    setValue((v) => {
      const next = !v;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        /* storage unavailable: the choice lasts for this visit only */
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}
