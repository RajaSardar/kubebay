import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleSection } from "@kubebay/ui";

describe("CollapsibleSection", () => {
  it("shows a count and renders its body only while open", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <CollapsibleSection title="Findings" count={7} open={false} onToggle={onToggle}>
        <div>body text</div>
      </CollapsibleSection>,
    );
    const b = screen.getByRole("button", { name: /Findings/ });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("body text")).toBeNull();
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <CollapsibleSection title="Findings" count={7} open onToggle={onToggle}>
        <div>body text</div>
      </CollapsibleSection>,
    );
    expect(screen.getByRole("button", { name: /Findings/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("body text")).toBeInTheDocument();
  });
});
