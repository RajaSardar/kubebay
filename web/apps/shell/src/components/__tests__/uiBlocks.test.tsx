/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Card, Grid } from "@kubebay/ui";

// Cards, banners and empty states are blocks: square shapes told apart by
// shade, with no outline, no resting shadow and no lift on hover.
const stylesCss = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");

/** The body of the rule whose selector list is exactly `sel`. */
function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`, "m").exec(stylesCss)?.[1] ?? "";
}
const decl = (body: string, prop: string) => new RegExp(`(?:^|;|\\{|\\s)${prop}\\s*:\\s*([^;]+);`).exec(body)?.[1]?.trim();

describe("Grid", () => {
  it("lays cards out in columns with a gap from the spacing scale, not margins", () => {
    render(
      <Grid gap={2} min={300} data-testid="grid">
        <Card>a</Card>
        <Card>b</Card>
      </Grid>,
    );
    const grid = screen.getByTestId("grid");
    expect(grid).toHaveClass("kb-grid", "kb-gap-2");
    expect(grid.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(300px, 1fr))");
    expect(decl(rule(".kb-grid"), "display")).toBe("grid");
  });

  it("defaults to a gap of 2 (8px) and 300px columns", () => {
    render(<Grid data-testid="grid" />);
    expect(screen.getByTestId("grid")).toHaveClass("kb-grid", "kb-gap-2");
    expect(screen.getByTestId("grid").style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(300px, 1fr))");
  });
});

describe("Card is a block", () => {
  const card = rule(".kb-card");

  it("has no visible outline in normal themes: its edge is the card-edge token", () => {
    expect(decl(card, "border")).toBe("1px solid var(--kb-card-edge)");
    expect(decl(card, "border-radius")).toBe("var(--kb-radius-tile)");
    expect(decl(card, "background")).toBe("var(--kb-bg-surface)");
    expect(decl(card, "box-shadow")).toBeUndefined();
    expect(card).not.toMatch(/transform/);
  });

  it("shades on hover without lifting", () => {
    const hover = rule(".kb-card-interactive:hover");
    expect(hover).not.toMatch(/transform|box-shadow|border-color/);
    expect(decl(hover, "background-image")).toBe("linear-gradient(var(--kb-bg-hover), var(--kb-bg-hover))");
  });

  it("a ChoiceCard (theme card) also shades on hover without lifting", () => {
    const hover = rule(".kb-choice-card:hover");
    expect(hover).not.toMatch(/transform|box-shadow/);
    expect(decl(hover, "background-image")).toBe("linear-gradient(var(--kb-bg-hover), var(--kb-bg-hover))");
    expect(rule(".kb-choice-card")).not.toMatch(/transform/);
  });

  it("keeps the 3px accent bar when selected", () => {
    expect(decl(rule(".kb-card-selected"), "box-shadow")).toBe("inset 3px 0 0 var(--kb-accent)");
  });
});

describe("banners and empty states are square blocks", () => {
  it("an inline banner has a 3px leading status bar, not a tinted outline", () => {
    const b = rule(".inline-banner");
    expect(decl(b, "border")).toBe("0");
    expect(decl(b, "border-left")).toBe("3px solid var(--kb-status-err)");
    expect(decl(b, "border-radius")).toBe("var(--kb-radius-tile)");
    expect(decl(rule(".inline-banner.ok"), "border-left-color")).toBe("var(--kb-status-ok)");
    expect(decl(rule(".inline-banner.warn"), "border-left-color")).toBe("var(--kb-status-warn)");
    expect(stylesCss).not.toMatch(/\.inline-banner[^{]*\{[^}]*color-mix\(in srgb, var\(--kb-status-\w+\) 35%/);
  });

  it("an empty state is a plain surface block with no dashed border", () => {
    const e = rule(".empty-state");
    expect(e).not.toMatch(/dashed/);
    expect(decl(e, "border")).toBe("1px solid var(--kb-card-edge)");
    expect(decl(e, "background")).toBe("var(--kb-bg-surface)");
    expect(decl(e, "border-radius")).toBe("var(--kb-radius-tile)");
  });
});
