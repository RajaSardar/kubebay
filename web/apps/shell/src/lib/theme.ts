import { create } from "zustand";

export type ThemeName = "dusk" | "dawn" | "system" | "dusk-hc" | "dawn-hc";

interface ThemeState {
  theme: ThemeName;
  resolved: Exclude<ThemeName, "system">;
  setTheme: (t: ThemeName) => void;
}

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(t: ThemeName): Exclude<ThemeName, "system"> {
  if (t !== "system") return t;
  return systemPrefersDark() ? "dusk" : "dawn";
}

const stored = (localStorage.getItem("kb.theme") as ThemeName | null) ?? "dusk";

export const useTheme = create<ThemeState>((set) => ({
  theme: stored,
  resolved: resolve(stored),
  setTheme: (t) => {
    localStorage.setItem("kb.theme", t);
    set({ theme: t, resolved: resolve(t) });
  },
}));

if (typeof window !== "undefined") {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    const { theme, setTheme } = useTheme.getState();
    if (theme === "system") setTheme("system");
  });
  useTheme.subscribe((s) => {
    document.documentElement.dataset.theme = s.resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--kb-theme-color").trim());
  });
  document.documentElement.dataset.theme = resolve(stored);
}
