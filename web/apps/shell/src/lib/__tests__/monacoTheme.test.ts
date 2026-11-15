import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

describe("monacoThemeFor", () => {
  it.each([
    ["dawn", "vs"],
    ["github-light", "vs"],
    ["dusk", "vs-dark"],
    ["nord", "vs-dark"],
    ["dusk-hc", "hc-black"],
    ["dawn-hc", "hc-light"],
  ])("%s uses Monaco's %s theme", async (theme, want) => {
    const { monacoThemeFor } = await import("../theme");
    expect(monacoThemeFor(theme as never)).toBe(want);
  });
});
