import { create } from "zustand";

export type FontSize = "sm" | "md" | "lg" | "xl";
export type FontFamily = "system" | "mono" | "jetbrains";
export type Density = "compact" | "default" | "relaxed";

// Every font size in the app is one of the --kb-text-* tokens, so a size
// setting sets them all: whole pixels only (half pixels render fuzzy). M is
// the default and matches Lens and Freelens: 14px body, 12px small print.
const TEXT_STEPS = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"] as const;
export const TYPE_SCALE: Record<FontSize, readonly number[]> = {
  sm: [10, 11, 12, 13, 15, 18, 28],
  md: [11, 12, 13, 14, 16, 20, 30],
  lg: [12, 13, 14, 15, 17, 21, 32],
  xl: [13, 14, 15, 16, 18, 22, 34],
};

const FONT_FAMILY_VALUES: Record<FontFamily, string> = {
  system: '"Roboto", -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace',
  jetbrains: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
};

const ROW_PADDING_VALUES: Record<Density, string> = {
  compact: "4px 16px",
  default: "8px 16px",
  relaxed: "12px 16px",
};

// Row height (px) per density, for virtualised tables; in step with ROW_PADDING_VALUES.
// The 26px row-menu button (.kb-icon-btn), not the text line, sets the height:
// compact: 4+4px pad + 26px button + 1px border = 35px
// default: 8+8px pad + 26px button + 1px border = 43px
// relaxed: 12+12px pad + 26px button + 1px border = 51px
export const ROW_HEIGHT: Record<Density, number> = {
  compact: 35,
  default: 43,
  relaxed: 51,
};

// Table text follows the font size: a step below body when compact, a step above when relaxed.
const TABLE_FONT_SIZE_VALUES: Record<Density, string> = {
  compact: "var(--kb-text-sm)",
  default: "var(--kb-text-md)",
  relaxed: "var(--kb-text-lg)",
};

// Monospace runs wide, so names, IPs and ages sit a step below the table's text.
const TABLE_MONO_FONT_SIZE_VALUES: Record<Density, string> = {
  compact: "var(--kb-text-xs)",
  default: "var(--kb-text-sm)",
  relaxed: "var(--kb-text-md)",
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
  TYPE_SCALE[s.fontSize].forEach((px, i) => root.style.setProperty(`--kb-text-${TEXT_STEPS[i]}`, `${px}px`));
  root.style.setProperty("--kb-font", FONT_FAMILY_VALUES[s.fontFamily]);
  root.style.setProperty("--kb-row-padding", ROW_PADDING_VALUES[s.density]);
  root.style.setProperty("--kb-table-font-size", TABLE_FONT_SIZE_VALUES[s.density]);
  root.style.setProperty("--kb-table-mono-font-size", TABLE_MONO_FONT_SIZE_VALUES[s.density]);
}

/** A saved size, including the old XS–L scale (xs was the smallest, so it reads as S). */
function savedFontSize(): FontSize {
  const v = localStorage.getItem("kb.fontSize");
  if (v === "xs") return "sm";
  return v === "sm" || v === "md" || v === "lg" || v === "xl" ? v : "md";
}

const stored = {
  fontSize: savedFontSize(),
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
