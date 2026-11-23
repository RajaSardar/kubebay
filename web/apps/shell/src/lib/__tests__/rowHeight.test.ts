/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ROW_HEIGHT } from "../display";

// Virtualised tables estimate each row's height before it is measured, so the
// estimate must be what really sets a row's height. The text sets it: a fixed
// line box plus the density's vertical padding (rows draw no rule between
// them). The row-menu cell has no padding, so its 26px ⋮ button fits inside
// even a compact row instead of stretching every row to button + padding.
describe("ROW_HEIGHT", () => {
  const styles = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
  const display = readFileSync(resolve(__dirname, "../display.ts"), "utf8");
  const rule = (selector: string) => {
    const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = new RegExp(`(?:^|\\n)${esc} \\{([^}]*)\\}`).exec(styles);
    expect(m, `${selector} rule`).not.toBeNull();
    return m![1]!;
  };
  const lineBox = Number(/line-height:\s*(\d+)px/.exec(rule(".kb-table td"))?.[1]);
  const button = Number(/\bheight:\s*(\d+)px/.exec(rule(".kb-icon-btn"))![1]);
  const padding = (d: string) => Number(new RegExp(`${d}: "(\\d+)px`).exec(display.slice(display.indexOf("ROW_PADDING_VALUES")))![1]);

  it("a table cell has a fixed 20px line box", () => {
    expect(lineBox).toBe(20);
  });

  it.each(["compact", "default", "relaxed"] as const)("%s = the line box + vertical padding, no phantom rule", (d) => {
    expect(ROW_HEIGHT[d]).toBe(lineBox + 2 * padding(d));
  });

  it("rows are 28, 32 and 40px", () => {
    expect(ROW_HEIGHT).toEqual({ compact: 28, default: 32, relaxed: 40 });
  });

  it("the row-menu cell's padding 0 wins over the table cell padding", () => {
    // `.col-row-menu { padding: 0 }` (0,1,0) lost to `.kb-table td` (0,1,1).
    expect(rule(".kb-table td.col-row-menu")).toMatch(/\bpadding:\s*0;/);
  });

  it("the 26px row-menu button fits inside the smallest row", () => {
    expect(button).toBeLessThanOrEqual(ROW_HEIGHT.compact);
  });

  it("a status pill fits inside the line box, so it doesn't stretch the row", () => {
    const pill = rule(".status-ok");
    const lh = Number(/line-height:\s*(\d+)px/.exec(pill)?.[1]);
    const pad = Number(/padding:\s*(\d+)px/.exec(pill)![1]);
    const border = Number(/border:\s*(\d+)px/.exec(pill)![1]);
    expect(lh + 2 * pad + 2 * border).toBeLessThanOrEqual(lineBox);
  });
});
