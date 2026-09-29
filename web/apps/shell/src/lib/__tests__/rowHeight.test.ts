/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROW_HEIGHT } from "../display";

// Virtualised tables estimate each row's height before it is measured. The
// estimate was 29/37/45px (a 20px text line), but every row carries the 26px
// ⋮ row-menu button, so real rows are 35/43/51px. The gap put the active row
// half off-screen after a keyboard move and made the scrollbar jump as rows
// were measured. Pin the estimate to what actually sets the height.
describe("ROW_HEIGHT", () => {
  const styles = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
  const display = readFileSync(resolve(__dirname, "../display.ts"), "utf8");
  const button = Number(/\.kb-icon-btn \{[^}]*?\bheight:\s*(\d+)px/.exec(styles)![1]);
  const padding = (d: string) => Number(new RegExp(`${d}: "(\\d+)px`).exec(display.slice(display.indexOf("ROW_PADDING_VALUES")))![1]);

  it.each(["compact", "default", "relaxed"] as const)("%s = the row-menu button + vertical padding + the 1px rule", (d) => {
    expect(ROW_HEIGHT[d]).toBe(button + 2 * padding(d) + 1);
  });
});
