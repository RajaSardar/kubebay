import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UnschedulablePods } from "../UnschedulablePods";
import type { UnschedulablePod } from "../../lib/karpenter";

function row(overrides: Partial<UnschedulablePod> = {}): UnschedulablePod {
  return {
    ns: "default",
    pod: "p1",
    message: "0/3 nodes are available: 3 Insufficient cpu.",
    count: 5,
    lastTimestamp: "2026-09-27T10:00:00Z",
    ...overrides,
  };
}

describe("UnschedulablePods", () => {
  it("shows an all-clear state when nothing is unschedulable", () => {
    render(<UnschedulablePods rows={[]} />);
    expect(screen.getByText(/no unschedulable pods/i)).toBeTruthy();
  });

  it("quotes the FailedScheduling message verbatim", () => {
    render(<UnschedulablePods rows={[row()]} />);
    expect(screen.getByText("0/3 nodes are available: 3 Insufficient cpu.")).toBeTruthy();
    expect(screen.getByText("p1")).toBeTruthy();
  });
});
