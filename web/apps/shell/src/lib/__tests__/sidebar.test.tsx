/// <reference types="node" />
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HideSidebarButton, ShowSidebarButton } from "../../components/SidebarToggle";
import { useSidebar } from "../useSidebar";

// The left nav hides from a button inside it and comes back from a button on
// the cluster rail (or ⌘B / Ctrl+B, as in VS Code); the choice is remembered.

function Harness() {
  const sb = useSidebar();
  return (
    <div className={sb.hidden ? "app sidebar-hidden" : "app"}>
      <div className="cluster-strip">{sb.hidden && <ShowSidebarButton sidebar={sb} />}</div>
      <aside id="kb-sidebar" className="sidebar" hidden={sb.hidden}>
        <HideSidebarButton sidebar={sb} />
        <input aria-label="field" />
      </aside>
    </div>
  );
}

describe("collapsible left nav", () => {
  beforeEach(() => localStorage.clear());

  it("hides from its own button, comes back from the rail, and moves focus to the visible button", () => {
    render(<Harness />);
    const hide = screen.getByRole("button", { name: "Hide sidebar" });
    expect(hide).toHaveAttribute("aria-controls", "kb-sidebar");
    expect(hide).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(hide);
    expect(document.getElementById("kb-sidebar")).not.toBeVisible();
    const show = screen.getByRole("button", { name: "Show sidebar" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(show).toHaveFocus();
    fireEvent.click(show);
    expect(document.getElementById("kb-sidebar")).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toHaveFocus();
  });

  it("remembers the choice across a reload", () => {
    const first = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    first.unmount();
    render(<Harness />);
    expect(document.getElementById("kb-sidebar")).not.toBeVisible();
    expect(localStorage.getItem("kb.sidebar.hidden")).toBe("1");
  });

  it("toggles with ⌘B or Ctrl+B, but not while typing", () => {
    render(<Harness />);
    act(() => void fireEvent.keyDown(window, { key: "b", metaKey: true }));
    expect(document.getElementById("kb-sidebar")).not.toBeVisible();
    act(() => void fireEvent.keyDown(window, { key: "b", ctrlKey: true }));
    expect(document.getElementById("kb-sidebar")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "field" }), { key: "b", ctrlKey: true });
    expect(document.getElementById("kb-sidebar")).toBeVisible();
  });

  it("the app wires it: the sidebar has its id and hidden state, the grid closes the gap", () => {
    const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");
    expect(app).toMatch(/useSidebar\(\)/);
    expect(app).toMatch(/<aside[^>]*id="kb-sidebar"[^>]*hidden=\{/);
    expect(app).toMatch(/<HideSidebarButton\b/);
    expect(app).toMatch(/<ShowSidebarButton\b/);
    const css = readFileSync(resolve(__dirname, "../../app.css"), "utf8");
    expect(css).toMatch(/\.app\.sidebar-hidden\s*\{[^}]*grid-template-columns:\s*56px 0 minmax\(0, 1fr\)/);
    // .sidebar sets display:flex, which beats the browser's [hidden] rule.
    expect(css).toMatch(/\.sidebar\[hidden\]\s*\{[^}]*display:\s*none/);
  });
});
