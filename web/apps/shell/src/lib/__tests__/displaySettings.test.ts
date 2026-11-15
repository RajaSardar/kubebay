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
