/// <reference types="node" />
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { SidebarResizer } from "../../components/SidebarResizer";
import { SIDEBAR_DEFAULT_W, useSidebar } from "../useSidebar";

// The left nav is resized by dragging its right edge. Its width is the --kb-sidebar-w token's
// value until you change it, then it is remembered in this browser (read when a window starts, like
// the other layout keys, so one window never moves another).

describe("sidebar width", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the --kb-sidebar-w token", () => {
    const tokens = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/tokens.css"), "utf8");
    expect(SIDEBAR_DEFAULT_W).toBe(Number(/--kb-sidebar-w:\s*(\d+)px/.exec(tokens)![1]));
  });

  it("remembers a width and restores it on the next launch", () => {
    const a = renderHook(() => useSidebar());
    expect(a.result.current.width).toBe(210);
    act(() => a.result.current.setWidth(300));
    expect(localStorage.getItem("kb.sidebar.width")).toBe("300");
    expect(renderHook(() => useSidebar()).result.current.width).toBe(300);
    act(() => a.result.current.resetWidth());
    expect(localStorage.getItem("kb.sidebar.width")).toBeNull();
    expect(a.result.current.width).toBe(210);
  });

  it("holds a saved width within 160 to 420", () => {
    localStorage.setItem("kb.sidebar.width", "50");
    expect(renderHook(() => useSidebar()).result.current.width).toBe(160);
  });
});

function Harness() {
  const sb = useSidebar();
  return (
    <div className={sb.hidden ? "app sidebar-hidden" : "app"}>
      <aside id="kb-sidebar" className="sidebar" hidden={sb.hidden} />
      <SidebarResizer sidebar={sb} />
      <output data-testid="w">{sb.width}</output>
    </div>
  );
}

describe("SidebarResizer", () => {
  beforeEach(() => localStorage.clear());

  it("is a separator on the sidebar's right edge: → widens, double-click resets", () => {
    render(<Harness />);
    const h = screen.getByRole("separator", { name: "Resize the sidebar" });
    expect(h).toHaveAttribute("aria-valuenow", "210");
    fireEvent.keyDown(h, { key: "ArrowRight" });
    expect(screen.getByTestId("w")).toHaveTextContent("226");
    fireEvent.doubleClick(h);
    expect(screen.getByTestId("w")).toHaveTextContent("210");
  });

  it("dragging it far to the left collapses the sidebar", () => {
    render(<Harness />);
    const h = screen.getByRole("separator");
    fireEvent.pointerDown(h, { clientX: 266, button: 0, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 20, pointerId: 1 });
    expect(document.getElementById("kb-sidebar")).not.toBeVisible();
    // The width it had is kept for when it comes back.
    expect(localStorage.getItem("kb.sidebar.width")).not.toBe("0");
  });

  it("is gone while the sidebar is hidden", () => {
    localStorage.setItem("kb.sidebar.hidden", "1");
    render(<Harness />);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("the layout reads the width from the token, set on .app", () => {
    const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");
    expect(app).toMatch(/--kb-sidebar-w/);
  });
});
