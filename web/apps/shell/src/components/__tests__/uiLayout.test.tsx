/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Row, Stack } from "@kubebay/ui";

const stylesCss = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
const rule = (sel: string) => new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`).exec(stylesCss)?.[1] ?? "";

describe("Row and Stack", () => {
  it("Row lays children out in a line with a gap from the spacing scale", () => {
    render(
      <Row gap={2} align="center" justify="between" wrap data-testid="row">
        <span>a</span>
      </Row>,
    );
    const row = screen.getByTestId("row");
    expect(row.tagName).toBe("DIV");
    expect(row).toHaveClass("kb-row", "kb-gap-2", "kb-align-center", "kb-justify-between", "kb-wrap");
    expect(row).not.toHaveAttribute("style");
  });

  it("Stack lays children out in a column", () => {
    render(<Stack gap={3} data-testid="stack" />);
    expect(screen.getByTestId("stack")).toHaveClass("kb-stack", "kb-gap-3");
    expect(screen.getByTestId("stack")).not.toHaveClass("kb-wrap");
  });

  it("keeps CSS defaults when no layout props are given", () => {
    render(<Row data-testid="row" />);
    expect(screen.getByTestId("row").className).toBe("kb-row");
  });

  it("passes through className, style, other attributes, a ref and the element", () => {
    const ref = createRef<HTMLElement>();
    render(
      <Stack ref={ref} as="section" className="extra" style={{ marginTop: 4 }} aria-label="Panel" gap={1}>
        body
      </Stack>,
    );
    const el = screen.getByRole("region", { name: "Panel" });
    expect(el.tagName).toBe("SECTION");
    expect(el).toHaveClass("kb-stack", "kb-gap-1", "extra");
    expect(el).toHaveStyle({ marginTop: "4px" });
    expect(ref.current).toBe(el);
  });

  it("styles.css gives every gap step its --kb-space token", () => {
    expect(rule(".kb-row")).toMatch(/display:\s*flex/);
    expect(rule(".kb-stack")).toMatch(/flex-direction:\s*column/);
    expect(rule(".kb-gap-0")).toMatch(/gap:\s*0/);
    for (const n of [1, 2, 3, 4, 5, 6]) expect(rule(`.kb-gap-${n}`)).toContain(`var(--kb-space-${n})`);
    expect(rule(".kb-justify-between")).toMatch(/space-between/);
    expect(rule(".kb-align-baseline")).toMatch(/baseline/);
    expect(rule(".kb-wrap")).toMatch(/flex-wrap:\s*wrap/);
  });
});
