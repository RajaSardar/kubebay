import { create } from "zustand";

export type ThemeName =
  | "dusk" | "dawn" | "system" | "dusk-hc" | "dawn-hc"
  | "vscode-dark" | "vscode-light"
  | "one-dark" | "dracula" | "nord"
  | "github-dark" | "github-light"
  | "catppuccin";

interface ThemeState {
  theme: ThemeName;
  resolved: Exclude<ThemeName, "system">;
  setTheme: (t: ThemeName) => void;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";
const CONTRAST_QUERY = "(prefers-contrast: more)";

function prefers(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * "system" follows the OS: dark or light, and the high-contrast variant when the
 * OS asks for more contrast. index.html's boot script mirrors this before paint.
 */
export function resolveTheme(t: ThemeName): Exclude<ThemeName, "system"> {
  if (t !== "system") return t;
  const base = prefers(DARK_QUERY) ? "dusk" : "dawn";
  return prefers(CONTRAST_QUERY) ? `${base}-hc` : base;
}

const resolve = resolveTheme;

// v2 = dawn became default (was dusk in v1).  On first run after this bump,
// reset to the new default so users see light mode by default.
const THEME_DEFAULT_VERSION = "2";
if (!localStorage.getItem("kb.theme.version")) {
  localStorage.removeItem("kb.theme");
  localStorage.setItem("kb.theme.version", THEME_DEFAULT_VERSION);
}
const stored = (localStorage.getItem("kb.theme") as ThemeName | null) ?? "dawn";

export const useTheme = create<ThemeState>((set) => ({
  theme: stored,
  resolved: resolve(stored),
  setTheme: (t) => {
    localStorage.setItem("kb.theme", t);
    set({ theme: t, resolved: resolve(t) });
  },
}));

const LIGHT_THEMES = new Set<ThemeName>(["dawn", "dawn-hc", "vscode-light", "github-light"]);

/**
 * Monaco ships its own themes, so an editor does not follow our CSS variables.
 * Pick the matching built-in instead of hardcoding one.
 */
export function useMonacoTheme(): "vs" | "vs-dark" {
  return LIGHT_THEMES.has(useTheme((s) => s.resolved)) ? "vs" : "vs-dark";
}

if (typeof window !== "undefined") {
  for (const q of [DARK_QUERY, CONTRAST_QUERY]) {
    window.matchMedia?.(q).addEventListener("change", () => {
      const { theme, setTheme } = useTheme.getState();
      if (theme === "system") setTheme("system");
    });
  }
  useTheme.subscribe((s) => {
    document.documentElement.dataset.theme = s.resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--kb-theme-color").trim());
  });
  document.documentElement.dataset.theme = resolve(stored);
}
