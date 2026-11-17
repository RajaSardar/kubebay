/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Backlog #40: table rows have no divider lines. The header keeps its underline, and rows are told
// apart by the hover and selected tints, which have to stay.
const css = readFileSync(resolve(__dirname, "../../../../packages/ui/src/styles.css"), "utf8");
const rule = (selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  expect(m, `no rule for ${selector}`).toBeTruthy();
  return m![1]!;
};
const hasLine = (body: string) => /border(?:-bottom|-top)?\s*:\s*(?!none|0\b)[^;]*(?:solid|dashed|dotted)/.test(body);

describe("table row lines", () => {
  it("body cells draw no divider line", () => {
    expect(hasLine(rule(".kb-table td")), ".kb-table td still draws a border").toBe(false);
  });

  it("body rows draw none either", () => {
    expect(hasLine(rule(".kb-table tbody tr"))).toBe(false);
  });

  it("the header keeps its underline, so the columns are still labelled apart from the data", () => {
    expect(rule(".kb-table th")).toMatch(/border-bottom:\s*1px solid var\(--kb-border-subtle\)/);
  });

  it("without lines, rows are still told apart by a hover tint and a selected tint with its accent bar", () => {
    expect(rule(".kb-table tbody tr:hover")).toMatch(/background:/);
    const selected = rule(".kb-table tbody tr.selected");
    expect(selected).toMatch(/background:/);
    expect(selected).toMatch(/box-shadow:\s*inset 3px 0 0/);
  });
});
