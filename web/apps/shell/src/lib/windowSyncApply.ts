import { useDisplay, TYPE_SCALE, ROW_HEIGHT } from "./display";
import type { Density, FontFamily, FontSize } from "./display";
import { useTheme } from "./theme";
import type { ThemeName } from "./theme";
import { onSharedPrefChange } from "./windowSync";
import type { SharedKey } from "./windowSync";

const THEMES: readonly ThemeName[] = [
  "dusk", "dawn", "system", "dusk-hc", "dawn-hc", "vscode-dark", "vscode-light",
  "one-dark", "dracula", "nord", "github-dark", "github-light", "catppuccin",
];
const FAMILIES: readonly FontFamily[] = ["system", "mono", "jetbrains"];

/** Takes a theme, font or density another window just saved. The setters write the same value back, which fires no further event. */
export function applySharedPref(key: SharedKey, value: string): void {
  switch (key) {
    case "kb.theme":
      if ((THEMES as readonly string[]).includes(value)) useTheme.getState().setTheme(value as ThemeName);
      break;
    case "kb.fontSize":
      if (value in TYPE_SCALE) useDisplay.getState().setFontSize(value as FontSize);
      break;
    case "kb.fontFamily":
      if ((FAMILIES as readonly string[]).includes(value)) useDisplay.getState().setFontFamily(value as FontFamily);
      break;
    case "kb.density":
      if (value in ROW_HEIGHT) useDisplay.getState().setDensity(value as Density);
      break;
  }
}

/** Keeps this window's appearance in step with the other windows. */
export function startWindowSync(): () => void {
  return onSharedPrefChange(applySharedPref);
}
