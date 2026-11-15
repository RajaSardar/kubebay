import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A looping CSS animation keeps the web view producing frames, and the
// compositor redrawing the window, for as long as it is on screen, so an app
// that looks idle never lets the machine idle. A loop is for something that is
// loading, and ends when the loading does; what stays on screen (the "live"
// pill, a pending status dot) pulses a few times and then rests.
// (The size of the effect was not measured: the one attempt was too noisy to
// trust, so no number is claimed here.)

const FILES = ["../../../../packages/ui/src/styles.css", "../app.css"];

function loopingAnimations(): { file: string; selector: string }[] {
  const out: { file: string; selector: string }[] = [];
  for (const f of FILES) {
    const css = readFileSync(resolve(__dirname, f), "utf8");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*animation:[^;{}]*\binfinite\b[^;{}]*;?[^{}]*)\}/g)) {
      out.push({ file: f.split("/").pop()!, selector: m[1]!.trim().split("\n").pop()!.trim() });
    }
  }
  return out;
}

// Each of these is shown only while something loads or connects.
const WHILE_LOADING = [
  ".kb-skeleton::after",
  ".palette-section-loading::before",
  ".kb-table-progress::after",
  ".kb-spinner svg",
  ".conn-avatar",
  ".conn-pulse",
];

describe("looping animations", () => {
  it("are only on things that are loading", () => {
    expect(loopingAnimations().map((a) => a.selector).sort()).toEqual([...WHILE_LOADING].sort());
  });

  it("do not include the live pill or a pending status dot, which stay on screen", () => {
    const sel = loopingAnimations().map((a) => a.selector);
    expect(sel).not.toContain(".live-pill::before");
    expect(sel).not.toContain(".kb-dot-pulse");
  });

  it("still give the live pill and a pending dot a short pulse when they appear", () => {
    const css = readFileSync(resolve(__dirname, FILES[0]!), "utf8");
    expect(css).toMatch(/\.live-pill::before\s*\{[^}]*animation:\s*kb-pulse\s+1\.6s\s+ease-in-out\s+3\b/);
    expect(css).toMatch(/\.kb-dot-pulse\s*\{\s*animation:\s*kb-pulse\s+1\.6s\s+ease-in-out\s+3\b/);
  });
});
