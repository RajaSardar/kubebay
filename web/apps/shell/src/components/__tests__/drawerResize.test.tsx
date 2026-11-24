import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Drawer } from "@kubebay/ui";

// The right-hand window of a Pod, Deployment, Service... is resized by dragging its left edge.
// One width is kept for every kind of drawer, in this browser, and read when a window starts.

describe("Drawer resizing", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1600 });
  });

  const dialog = () => screen.getByRole("dialog");
  const widthOf = () => (dialog() as HTMLElement).style.width;

  it("starts at the default 820px, with a handle on its left edge", () => {
    render(<Drawer title="api" onClose={() => {}} />);
    const h = screen.getByRole("separator", { name: "Resize the panel" });
    expect(h).toHaveAttribute("aria-valuenow", "820");
    expect(dialog().contains(h)).toBe(true);
    expect(widthOf()).toBe("820px");
  });

  it("the default is still three quarters of a narrow window", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    render(<Drawer title="api" onClose={() => {}} />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-valuenow", "600");
  });

  it("← widens it, → narrows it, and the width is saved", () => {
    render(<Drawer title="api" onClose={() => {}} />);
    const h = screen.getByRole("separator");
    fireEvent.keyDown(h, { key: "ArrowLeft", shiftKey: true });
    expect(widthOf()).toBe("884px");
    expect(localStorage.getItem("kb.drawer.width")).toBe("884");
    fireEvent.keyDown(h, { key: "ArrowRight" });
    expect(h).toHaveAttribute("aria-valuenow", "868");
  });

  it("dragging its edge left widens it", () => {
    render(<Drawer title="api" onClose={() => {}} />);
    const h = screen.getByRole("separator");
    fireEvent.pointerDown(h, { clientX: 780, button: 0, pointerId: 1 });
    fireEvent.pointerMove(h, { clientX: 680, pointerId: 1 });
    expect(widthOf()).toBe("920px");
  });

  it("a double-click restores the default and forgets the saved width", () => {
    localStorage.setItem("kb.drawer.width", "1000");
    render(<Drawer title="api" onClose={() => {}} />);
    const h = screen.getByRole("separator");
    expect(h).toHaveAttribute("aria-valuenow", "1000");
    fireEvent.doubleClick(h);
    expect(widthOf()).toBe("820px");
    expect(localStorage.getItem("kb.drawer.width")).toBeNull();
  });

  it("is never narrower than 360px", () => {
    render(<Drawer title="api" onClose={() => {}} />);
    const h = screen.getByRole("separator");
    fireEvent.keyDown(h, { key: "Home" });
    expect(h).toHaveAttribute("aria-valuenow", "360");
  });

  it("the full-page view has no handle", () => {
    render(<Drawer embedded title="api" onClose={() => {}} />);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("pressing the handle does not close the drawer", () => {
    let closed = false;
    render(<Drawer title="api" onClose={() => (closed = true)} />);
    fireEvent.mouseDown(screen.getByRole("separator"));
    expect(closed).toBe(false);
  });
});
