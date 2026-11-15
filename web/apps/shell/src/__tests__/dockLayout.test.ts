/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ADR 0005: the terminal dock is a row of the content column, and what floats
// over the page's bottom edge rides above it.

const css = readFileSync(resolve(__dirname, "../app.css"), "utf8");
const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(".", "\\.")}\\s*\\{([^}]*)\\}`))?.[2] ?? "";

describe("the dock's place in the layout", () => {
  it("is a row of the content column; the cluster strip and sidebar run beside it", () => {
    expect(rule(".app")).toMatch(/"cluster-strip sidebar content"\s*"cluster-strip sidebar dock"\s*"statusbar statusbar statusbar"/);
  });

  it("lifts the floating + above the open dock", () => {
    expect(rule(".app")).toMatch(/--kb-dock-inset:\s*0px/);
    expect(rule(".resource-fab")).toMatch(/bottom:\s*calc\(28px \+ var\(--kb-dock-inset\)\)/);
    expect(app).toMatch(/"--kb-dock-inset"/);
  });
});
