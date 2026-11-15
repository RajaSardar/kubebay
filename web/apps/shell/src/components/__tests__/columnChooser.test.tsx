import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { ColumnChooser } from "@kubebay/ui";

// #21: the chooser is a button that opens a small panel: a checkbox per
// column, Move up / Move down (keyboard and pointer alike, WCAG 2.5.7), and
// Reset. Escape or a click outside closes it and focus returns to the button.

const columns = [
  { id: "Namespace", label: "Namespace", shown: true },
  { id: "Status", label: "Status", shown: true },
  { id: "Zone", label: "Zone", shown: false },
];

function setup() {
  const onToggle = vi.fn();
  const onMove = vi.fn();
  const onReset = vi.fn();
  render(<ColumnChooser columns={columns} onToggle={onToggle} onMove={onMove} onReset={onReset} />);
  return { onToggle, onMove, onReset };
}

describe("ColumnChooser", () => {
  it("opens a named panel from its button and focuses the first column", () => {
    setup();
    const btn = screen.getByRole("button", { name: "Columns" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    const panel = screen.getByRole("dialog", { name: "Columns" });
    expect(within(panel).getByRole("checkbox", { name: "Namespace" })).toHaveFocus();
    expect(within(panel).getByRole("checkbox", { name: "Zone" })).not.toBeChecked();
  });

  it("toggles, moves and resets through its callbacks; the ends cannot move further", () => {
    const { onToggle, onMove, onReset } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Zone" }));
    expect(onToggle).toHaveBeenCalledWith("Zone");
    fireEvent.click(screen.getByRole("button", { name: "Move Status up" }));
    expect(onMove).toHaveBeenCalledWith("Status", -1);
    fireEvent.click(screen.getByRole("button", { name: "Move Status down" }));
    expect(onMove).toHaveBeenCalledWith("Status", 1);
    expect(screen.getByRole("button", { name: "Move Namespace up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Zone down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset columns" }));
    expect(onReset).toHaveBeenCalled();
  });

  it("closes on Escape and on a click outside, returning focus to its button", () => {
    setup();
    const btn = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(btn);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Columns" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Columns" })).toBeNull();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Columns" })).toBeNull();
  });

  it("closes on Escape even when focus has left the panel (a button it held became disabled)", () => {
    setup();
    const btn = screen.getByRole("button", { name: "Columns" });
    fireEvent.click(btn);
    (document.activeElement as HTMLElement).blur();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Columns" })).toBeNull();
    expect(btn).toHaveFocus();
  });
});
