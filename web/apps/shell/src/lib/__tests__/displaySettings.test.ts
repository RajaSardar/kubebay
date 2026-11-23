/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Settings → Display. Every font size in the app is a --kb-text-* token in
// px, so the Font size setting must move those tokens (changing the root's
// font-size moved nothing). Table density must change table text as well as
// padding, so a cell must not pin its own size.

const root = () => document.documentElement.style;

async function load() {
  vi.resetModules();
  return (await import("../display")).useDisplay;
}

describe("Display settings", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("defaults to a 14px body, like Lens and Freelens", async () => {
    await load();
    expect(root().getPropertyValue("--kb-text-md")).toBe("14px");
    expect(root().getPropertyValue("--kb-text-sm")).toBe("13px");
    expect(root().getPropertyValue("--kb-text-xs")).toBe("12px");
  });

  it("Font size scales the whole type scale, in whole pixels, and is remembered", async () => {
    const display = await load();
    display.getState().setFontSize("lg");
    expect(root().getPropertyValue("--kb-text-md")).toBe("15px");
    expect(root().getPropertyValue("--kb-text-2xs")).toBe("12px");
    expect(root().getPropertyValue("--kb-text-2xl")).toBe("32px");
    expect(localStorage.getItem("kb.fontSize")).toBe("lg");
    display.getState().setFontSize("sm");
    expect(root().getPropertyValue("--kb-text-md")).toBe("13px");
  });

  it("Table density changes table text with the rows' padding", async () => {
    const display = await load();
    display.getState().setDensity("compact");
    expect(root().getPropertyValue("--kb-table-font-size")).toBe("var(--kb-text-sm)");
    expect(root().getPropertyValue("--kb-row-padding")).toBe("4px 16px");
    display.getState().setDensity("relaxed");
    expect(root().getPropertyValue("--kb-table-font-size")).toBe("var(--kb-text-lg)");
  });

  it("monospace cells (names, IPs) follow density too, a step below the table's text", async () => {
    const display = await load();
    display.getState().setDensity("compact");
    expect(root().getPropertyValue("--kb-table-mono-font-size")).toBe("var(--kb-text-xs)");
    display.getState().setDensity("relaxed");
    expect(root().getPropertyValue("--kb-table-mono-font-size")).toBe("var(--kb-text-md)");
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    expect(css).toMatch(/\.kb-table td\.mono,\s*\.kb-table td \.mono \{\s*font-size: var\(--kb-table-mono-font-size, var\(--kb-text-sm\)\);/);
  });

  it("no type step is under 11px at any font size (S was 10px at its smallest)", async () => {
    const { TYPE_SCALE } = await import("../display");
    for (const [size, steps] of Object.entries(TYPE_SCALE)) {
      expect(Math.min(...steps), size).toBeGreaterThanOrEqual(11);
      expect([...steps].sort((a, b) => a - b), size).toEqual([...steps]);
    }
    expect(TYPE_SCALE.sm).toEqual([11, 11, 12, 13, 15, 18, 28]);
  });

  it("monospace cells are never under 12px, at any font size and density", async () => {
    const display = await load();
    const { TYPE_SCALE } = await import("../display");
    const steps = ["2xs", "xs", "sm", "md", "lg", "xl", "2xl"];
    for (const size of ["sm", "md", "lg", "xl"] as const) {
      for (const density of ["compact", "default", "relaxed"] as const) {
        display.getState().setFontSize(size);
        display.getState().setDensity(density);
        const step = /^var\(--kb-text-([\w]+)\)$/.exec(root().getPropertyValue("--kb-table-mono-font-size"))![1]!;
        expect(TYPE_SCALE[size][steps.indexOf(step)], `${size} ${density}`).toBeGreaterThanOrEqual(12);
      }
    }
    // The .mono class (names, IPs outside tables) is --kb-text-sm, 12px or more at every size.
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    expect(css).toMatch(/\n\.mono \{\s*font-family: var\(--kb-font-mono\);\s*font-size: var\(--kb-text-sm\);/);
    for (const steps of Object.values(TYPE_SCALE)) expect(steps[2]).toBeGreaterThanOrEqual(12);
  });

  it("reads an old saved size: xs (the smallest) becomes S", async () => {
    localStorage.setItem("kb.fontSize", "xs");
    const display = await load();
    expect(display.getState().fontSize).toBe("sm");
    expect(root().getPropertyValue("--kb-text-md")).toBe("13px");
  });

  it("a table cell takes the table's size instead of pinning its own", () => {
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    const td = /\.kb-table td \{([^}]*)\}/.exec(css)![1]!;
    expect(td).not.toMatch(/font-size/);
  });

  it("the stylesheet's own tokens match the default, so the first paint is the default size", () => {
    const tokens = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/tokens.css"), "utf8");
    expect(/--kb-text-md:\s*(\d+)px/.exec(tokens)![1]).toBe("14");
    expect(/--kb-text-xs:\s*(\d+)px/.exec(tokens)![1]).toBe("12");
  });
});
