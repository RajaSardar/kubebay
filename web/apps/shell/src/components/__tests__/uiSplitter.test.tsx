/// <reference types="node" />
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Splitter } from "@kubebay/ui";

// ADR 0005: the terminal dock's height is set by a Splitter on its top edge.
// Dragging or pressing ↑ grows the panel below it; keyboard resizing is an
// accessibility need, not a nicety.

function Host({ onChange }: { onChange?: (v: number) => void }) {
  const [h, setH] = useState(300);
  return (
    <Splitter
      label="Resize the terminal"
      value={h}
      min={120}
      max={500}
      defaultValue={280}
      onChange={(v) => {
        setH(v);
        onChange?.(v);
      }}
    />
  );
}

describe("Splitter", () => {
  it("is a horizontal separator that says its size and bounds", () => {
    render(<Host />);
    const s = screen.getByRole("separator", { name: "Resize the terminal" });
    expect(s).toHaveAttribute("aria-orientation", "horizontal");
    expect(s).toHaveAttribute("aria-valuenow", "300");
    expect(s).toHaveAttribute("aria-valuemin", "120");
    expect(s).toHaveAttribute("aria-valuemax", "500");
    expect(s).toHaveAttribute("tabindex", "0");
  });

  it("moves 16 px per arrow key, within its bounds", () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "ArrowUp" });
    expect(s).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(s, { key: "ArrowDown" });
    fireEvent.keyDown(s, { key: "ArrowDown" });
    expect(s).toHaveAttribute("aria-valuenow", "284");
    for (let i = 0; i < 40; i++) fireEvent.keyDown(s, { key: "ArrowUp" });
    expect(s).toHaveAttribute("aria-valuenow", "500");
    expect(onChange).toHaveBeenLastCalledWith(500);
  });

  it("resets on a double-click", () => {
    render(<Host />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "ArrowUp" });
    fireEvent.doubleClick(s);
    expect(s).toHaveAttribute("aria-valuenow", "280");
  });

  it("grows the panel below it when dragged up, and stops at its bounds", () => {
    render(<Host />);
    const s = screen.getByRole("separator");
    fireEvent.pointerDown(s, { clientY: 600, button: 0, pointerId: 1 });
    fireEvent.pointerMove(s, { clientY: 500, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "400");
    fireEvent.pointerMove(s, { clientY: 900, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "120");
    fireEvent.pointerUp(s, { clientY: 900, pointerId: 1 });
    fireEvent.pointerMove(s, { clientY: 300, pointerId: 1 });
    expect(s).toHaveAttribute("aria-valuenow", "120");
  });

  it("is styled by the package", () => {
    render(<Host />);
    expect(screen.getByRole("separator")).toHaveClass("kb-splitter");
    const css = readFileSync(resolve(__dirname, "../../../../../packages/ui/src/styles.css"), "utf8");
    expect(css).toMatch(/\.kb-splitter\s*\{/);
  });
});
