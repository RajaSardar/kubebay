/// <reference types="node" />
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ResizeHandle, useStoredWidth } from "@kubebay/ui";

// A panel beside the page (the sidebar, the drawer) is resized by dragging its edge. The handle is
// a vertical separator, so it works by keyboard too, and a double-click puts the width back.

function Host({
  grow = "right",
  onCollapse,
  onChange,
}: {
  grow?: "left" | "right";
  onCollapse?: () => void;
  onChange?: (v: number) => void;
}) {
  const [w, setW] = useState(300);
  return (
    <ResizeHandle
      label="Resize the panel"
      value={w}
      min={160}
      max={420}
      defaultValue={210}
      grow={grow}
      collapseBelow={100}
      onCollapse={onCollapse}
      onChange={(v) => {
        setW(v);
        onChange?.(v);
      }}
    />
  );
}

describe("ResizeHandle", () => {
  it("is a vertical separator that says its width and bounds", () => {
    render(<Host />);
    const s = screen.getByRole("separator", { name: "Resize the panel" });
    expect(s).toHaveAttribute("aria-orientation", "vertical");
    expect(s).toHaveAttribute("aria-valuenow", "300");
    expect(s).toHaveAttribute("aria-valuemin", "160");
    expect(s).toHaveAttribute("aria-valuemax", "420");
    expect(s).toHaveAttribute("tabindex", "0");
    expect(s).toHaveClass("kb-resize-handle");
  });

  it("a panel that grows to the right: → widens it 16px, ← narrows it, Shift moves 64px", () => {
    render(<Host />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(s).toHaveAttribute("aria-valuenow", "284");
    fireEvent.keyDown(s, { key: "ArrowRight", shiftKey: true });
    expect(s).toHaveAttribute("aria-valuenow", "348");
  });

  it("a panel that grows to the left: ← widens it", () => {
    render(<Host grow="left" />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(s).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s).toHaveAttribute("aria-valuenow", "284");
  });

  it("Home and End go to the bounds, and nothing goes past them", () => {
    render(<Host />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "End" });
    expect(s).toHaveAttribute("aria-valuenow", "420");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s).toHaveAttribute("aria-valuenow", "420");
    fireEvent.keyDown(s, { key: "Home" });
    expect(s).toHaveAttribute("aria-valuenow", "160");
    fireEvent.keyDown(s, { key: "ArrowLeft", shiftKey: true });
    expect(s).toHaveAttribute("aria-valuenow", "160");
  });

  it("resets to its default on a double-click", () => {
    render(<Host />);
    const s = screen.getByRole("separator");
    fireEvent.doubleClick(s);
    expect(s).toHaveAttribute("aria-valuenow", "210");
  });

  it("drags: right widens a right-growing panel, and stops at the bounds", () => {
    render(<Host />);
    const s = screen.getByRole("separator");
    fireEvent.pointerDown(s, { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 340, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "340");
    fireEvent.pointerMove(s, { clientX: 900, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "420");
    fireEvent.pointerMove(s, { clientX: 250, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "250");
    fireEvent.pointerUp(s, { clientX: 250, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 700, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "250");
  });

  it("drags: left widens a left-growing panel", () => {
    render(<Host grow="left" />);
    const s = screen.getByRole("separator");
    fireEvent.pointerDown(s, { clientX: 500, button: 0, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 450, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "350");
  });

  it("dragging well past the minimum collapses the panel instead of clamping", () => {
    const onCollapse = vi.fn();
    render(<Host onCollapse={onCollapse} />);
    const s = screen.getByRole("separator");
    fireEvent.pointerDown(s, { clientX: 300, button: 0, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 180, pointerId: 1 });
    expect(onCollapse).not.toHaveBeenCalled();
    expect(s).toHaveAttribute("aria-valuenow", "180");
    fireEvent.pointerMove(s, { clientX: 60, pointerId: 1 });
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("is styled by the package", () => {
    render(<Host />);
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    expect(css).toMatch(/\.kb-resize-handle\s*\{/);
  });
});

describe("useStoredWidth", () => {
  beforeEach(() => localStorage.clear());
  const opts = { min: 160, max: 420, defaultValue: 210 };

  it("starts at the default", () => {
    const { result } = renderHook(() => useStoredWidth("kb.test.width", opts));
    expect(result.current.width).toBe(210);
  });

  it("starts at the width saved by an earlier launch, held within the bounds", () => {
    localStorage.setItem("kb.test.width", "333");
    expect(renderHook(() => useStoredWidth("kb.test.width", opts)).result.current.width).toBe(333);
    localStorage.setItem("kb.test.width", "9999");
    expect(renderHook(() => useStoredWidth("kb.test.width", opts)).result.current.width).toBe(420);
    localStorage.setItem("kb.test.width", "banana");
    expect(renderHook(() => useStoredWidth("kb.test.width", opts)).result.current.width).toBe(210);
  });

  it("remembers a new width, and forgets it on reset", () => {
    const { result } = renderHook(() => useStoredWidth("kb.test.width", opts));
    act(() => result.current.setWidth(300));
    expect(result.current.width).toBe(300);
    expect(localStorage.getItem("kb.test.width")).toBe("300");
    act(() => result.current.reset());
    expect(result.current.width).toBe(210);
    expect(localStorage.getItem("kb.test.width")).toBeNull();
  });

  it("keeps working when storage is unavailable", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const { result } = renderHook(() => useStoredWidth("kb.test.width", opts));
    act(() => result.current.setWidth(250));
    expect(result.current.width).toBe(250);
    get.mockRestore();
    set.mockRestore();
  });
});
