// @vitest-environment jsdom
// jsdom has no layout, so these check structure (DOM order, classes), the CSS
// contract (read from styles.css) and the scroll-into-view call, not pixels.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { Drawer, IconButton, Tabs } from "@kubebay/ui";

describe("Drawer copy button placement and size (backlog 44)", () => {
  it("sits directly after the name, in the same row, and is the large size", () => {
    render(<Drawer title="api-7f9c" copyName="api-7f9c" onClose={() => {}} />);
    const name = screen.getByText("api-7f9c", { selector: ".drawer-name" });
    const btn = screen.getByRole("button", { name: "Copy name" });
    expect(name.nextElementSibling).toBe(btn);
    expect(name.parentElement).toBe(btn.parentElement);
    expect(btn.className).toContain("kb-icon-btn-lg");
    expect(btn.querySelector("svg")?.getAttribute("width")).toBe("18");
  });

  it("nameExtra (the favourite star) follows the Copy name button", () => {
    render(<Drawer title="api" copyName="api" nameExtra={<button>star</button>} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Copy name" }).nextElementSibling).toBe(screen.getByRole("button", { name: "star" }));
  });

  it("IconButton size=lg is opt-in", () => {
    render(
      <>
        <IconButton label="a">x</IconButton>
        <IconButton label="b" size="lg">
          x
        </IconButton>
      </>,
    );
    expect(screen.getByRole("button", { name: "a" }).className).not.toContain("kb-icon-btn-lg");
    expect(screen.getByRole("button", { name: "b" }).className).toContain("kb-icon-btn-lg");
  });
});

describe("Drawer header and tab strip never clip (backlog 45)", () => {
  const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
  const rule = (sel: string) => css.match(new RegExp(`(^|\\n)${sel.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[2] ?? "";

  it("tab strip scrolls horizontally and tabs do not shrink", () => {
    expect(rule(".drawer-pane-tabs")).toMatch(/overflow-x:\s*auto/);
    expect(rule(".drawer-pane-tabs .tab")).toMatch(/flex-shrink:\s*0/);
  });

  it("head actions wrap instead of being pushed out", () => {
    expect(rule(".drawer-head-actions")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".drawer-head")).toMatch(/flex-wrap:\s*wrap/);
  });

  it("scrolls the active tab into view when it changes", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const labels = { a: "A", b: "B" };
    const { rerender } = render(<Tabs tabs={["a", "b"] as const} active="a" labels={labels} onChange={() => {}} />);
    spy.mockClear();
    rerender(<Tabs tabs={["a", "b"] as const} active="b" labels={labels} onChange={() => {}} />);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.contexts[0]).toBe(screen.getByRole("tab", { name: "B" }));
  });
});
