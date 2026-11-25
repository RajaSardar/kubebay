import { describe, it, expect } from "vitest";
import { applySharedPref } from "../windowSyncApply";
import { useTheme } from "../theme";
import { useDisplay } from "../display";

describe("applySharedPref", () => {
  it("repaints this window when another window changes the theme", () => {
    applySharedPref("kb.theme", "dusk");
    expect(useTheme.getState().theme).toBe("dusk");
    expect(useTheme.getState().resolved).toBe("dusk");
  });

  it("takes Blossom and Blossom Night from another window", () => {
    for (const id of ["blossom", "blossom-night"] as const) {
      applySharedPref("kb.theme", id);
      expect(useTheme.getState().theme).toBe(id);
    }
  });

  it("follows font size, font family and density", () => {
    applySharedPref("kb.fontSize", "lg");
    applySharedPref("kb.fontFamily", "mono");
    applySharedPref("kb.density", "compact");
    const s = useDisplay.getState();
    expect([s.fontSize, s.fontFamily, s.density]).toEqual(["lg", "mono", "compact"]);
  });

  it("ignores a value it does not know", () => {
    applySharedPref("kb.density", "relaxed");
    applySharedPref("kb.density", "huge");
    applySharedPref("kb.theme", "dusk");
    applySharedPref("kb.theme", "nope");
    expect(useDisplay.getState().density).toBe("relaxed");
    expect(useTheme.getState().theme).toBe("dusk");
  });
});
