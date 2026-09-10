import { create } from "zustand";

export type FontSize = "xs" | "sm" | "md" | "lg";
export type FontFamily = "system" | "mono" | "jetbrains";
export type Density = "compact" | "default" | "relaxed";

const FONT_SIZE_VALUES: Record<FontSize, string> = {
  xs: "11px",
  sm: "12px",
  md: "13px",
  lg: "14px",
};

const FONT_FAMILY_VALUES: Record<FontFamily, string> = {
  system: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  jetbrains: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
};

const ROW_PADDING_VALUES: Record<Density, string> = {
  compact: "4px 14px",
  default: "8px 14px",
  relaxed: "12px 14px",
};

const TABLE_FONT_SIZE_VALUES: Record<Density, string> = {
  compact: "12px",
  default: "13px",
  relaxed: "14px",
};

interface DisplayState {
  fontSize: FontSize;
  fontFamily: FontFamily;
  density: Density;
  setFontSize: (v: FontSize) => void;
  setFontFamily: (v: FontFamily) => void;
  setDensity: (v: Density) => void;
}

function applyDisplay(s: Pick<DisplayState, "fontSize" | "fontFamily" | "density">) {
  const root = document.documentElement;
  root.style.setProperty("font-size", FONT_SIZE_VALUES[s.fontSize]);
  root.style.setProperty("--kb-font", FONT_FAMILY_VALUES[s.fontFamily]);
  root.style.setProperty("--kb-row-padding", ROW_PADDING_VALUES[s.density]);
  root.style.setProperty("--kb-table-font-size", TABLE_FONT_SIZE_VALUES[s.density]);
}

const stored = {
  fontSize: (localStorage.getItem("kb.fontSize") as FontSize | null) ?? "md",
  fontFamily: (localStorage.getItem("kb.fontFamily") as FontFamily | null) ?? "system",
  density: (localStorage.getItem("kb.density") as Density | null) ?? "default",
};

export const useDisplay = create<DisplayState>((set) => ({
  ...stored,
  setFontSize: (fontSize) => {
    localStorage.setItem("kb.fontSize", fontSize);
    set({ fontSize });
    applyDisplay({ ...useDisplay.getState(), fontSize });
  },
  setFontFamily: (fontFamily) => {
    localStorage.setItem("kb.fontFamily", fontFamily);
    set({ fontFamily });
    applyDisplay({ ...useDisplay.getState(), fontFamily });
  },
  setDensity: (density) => {
    localStorage.setItem("kb.density", density);
    set({ density });
    applyDisplay({ ...useDisplay.getState(), density });
  },
}));

// Apply on startup
if (typeof window !== "undefined") {
  applyDisplay(stored);
}
