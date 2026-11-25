import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Backlog 90: a document-level non-passive wheel listener cancelled every sideways
// trackpad gesture (it looked only at deltaY) and made all scrolling wait on the main thread.
// Bounce is stopped with CSS overscroll-behavior, never with a listener.
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "__tests__" || n === "test" ? [] : sources(p);
    return /\.(tsx?|jsx?)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
  });
}

describe("no wheel blocker", () => {
  it("no source adds a wheel listener that can preventDefault (passive:false)", () => {
    const bad = sources(join(__dirname, "..")).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /["']wheel["'][\s\S]{0,1500}passive:\s*false/.test(s) || /onWheel[\s\S]{0,200}preventDefault/.test(s);
    });
    expect(bad).toEqual([]);
  });

  it("the page stops window bounce in CSS", () => {
    const css = readFileSync(join(__dirname, "..", "app.css"), "utf8");
    expect(css).toMatch(/overscroll-behavior:\s*none/);
  });

  it("the table scroller does not chain overscroll to the window", () => {
    const css = readFileSync(join(__dirname, "..", "..", "..", "..", "packages", "ui", "src", "styles.css"), "utf8");
    const block = css.match(/\n\.table-wrap \{[^}]*\}/)![0];
    expect(block).toMatch(/overscroll-behavior:\s*none/);
  });
});
