import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChoiceCard, DisclosureButton } from "@kubebay/ui";

describe("DisclosureButton", () => {
  it("is a non-submitting button that says whether its section is open", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <DisclosureButton open={false} onToggle={onToggle} icon={<i data-testid="icon" />} count={12}>
        Workloads
      </DisclosureButton>,
    );
    const b = screen.getByRole("button", { name: /Workloads/ });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(b).toHaveClass("nav-group-title");
    expect(b).toContainElement(screen.getByTestId("icon"));
    expect(screen.getByText("12")).toHaveClass("nav-group-count");
    expect(b.querySelector("svg.chev")).not.toBeNull();
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <DisclosureButton open onToggle={onToggle}>
        Workloads
      </DisclosureButton>,
    );
    expect(screen.getByRole("button", { name: /Workloads/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("has a nested variant for sub-groups", () => {
    render(
      <DisclosureButton open={false} onToggle={() => {}} level="sub">
        argoproj.io
      </DisclosureButton>,
    );
    expect(screen.getByRole("button", { name: /argoproj/ })).toHaveClass("nav-subgroup-title");
  });
});

describe("ChoiceCard", () => {
  it("is a pressed-state button for picking one option from a grid of cards", () => {
    const onClick = vi.fn();
    render(
      <>
        <ChoiceCard selected onClick={onClick}>Dawn</ChoiceCard>
        <ChoiceCard selected={false} onClick={onClick}>Dusk</ChoiceCard>
      </>,
    );
    const dawn = screen.getByRole("button", { name: "Dawn" });
    expect(dawn).toHaveAttribute("type", "button");
    expect(dawn).toHaveAttribute("aria-pressed", "true");
    expect(dawn).toHaveClass("kb-choice-card", "active");
    const dusk = screen.getByRole("button", { name: "Dusk" });
    expect(dusk).toHaveAttribute("aria-pressed", "false");
    expect(dusk).not.toHaveClass("active");
    fireEvent.click(dusk);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
