import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HealthVerdictLine } from "../HealthVerdictLine";

const failing = { tone: "err" as const, word: "Failing" as const, sentence: "4 of 612 pods need attention · shop/api: Keeps crashing on start", outside: 0 };

describe("HealthVerdictLine", () => {
  it("puts the word beside the colour, then the sentence and the direction", () => {
    render(<HealthVerdictLine verdict={failing} trend="worse than 30 min ago" scope={[]} showingAll onToggleScope={vi.fn()} />);
    const region = screen.getByRole("region", { name: "Cluster health" });
    expect(within(region).getByRole("img", { name: "err" })).toBeInTheDocument();
    expect(within(region).getByText("Failing")).toBeInTheDocument();
    expect(within(region).getByText(failing.sentence)).toBeInTheDocument();
    expect(within(region).getByText("worse than 30 min ago")).toBeInTheDocument();
  });

  it("says nothing about direction when there are no warnings to compare", () => {
    render(<HealthVerdictLine verdict={{ ...failing, tone: "ok", word: "Healthy", sentence: "All 3 pods healthy" }} scope={[]} showingAll onToggleScope={vi.fn()} />);
    expect(screen.queryByText(/30 min ago|steady/)).not.toBeInTheDocument();
  });

  it("with your namespaces in scope, says what is wrong outside them and shows everything on a click", () => {
    const toggle = vi.fn();
    render(<HealthVerdictLine verdict={{ ...failing, outside: 2 }} scope={["shop", "pay"]} showingAll={false} onToggleScope={toggle} />);
    expect(screen.getByText("Your namespaces: shop, pay")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+2 outside your namespaces" }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("when showing everything, offers to go back to your namespaces", () => {
    const toggle = vi.fn();
    render(<HealthVerdictLine verdict={failing} scope={["shop"]} showingAll onToggleScope={toggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Only your namespaces" }));
    expect(toggle).toHaveBeenCalledOnce();
  });
});
