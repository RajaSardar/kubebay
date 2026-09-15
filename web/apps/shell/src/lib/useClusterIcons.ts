import { useState, useCallback } from "react";

const KEY = "kb.cluster-icons";

export interface ClusterIcon {
  bg: string;
  label: string;
}

function load(): Record<string, ClusterIcon> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function useClusterIcons() {
  const [icons, setIcons] = useState<Record<string, ClusterIcon>>(load);

  const setIcon = useCallback((clusterId: string, icon: ClusterIcon) => {
    setIcons((prev) => {
      const next = { ...prev, [clusterId]: icon };
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetIcon = useCallback((clusterId: string) => {
    setIcons((prev) => {
      const next = { ...prev };
      delete next[clusterId];
      localStorage.setItem(KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { icons, setIcon, resetIcon };
}
