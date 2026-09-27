import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NodePoolSummary } from "../NodePoolSummary";
import type { NodePoolRow } from "../../lib/karpenter";

function row(overrides: Partial<NodePoolRow> = {}): NodePoolRow {
  return {
    name: "default",
    nodeCount: 5,
    podCount: 40,
    namespaceCount: 6,
    spotCount: 3,
    onDemandCount: 2,
    limitCpuMillis: 1000 * 1000,
    limitMemBytes: 1000 * 1024 ** 3,
    usedCpuMillis: 32000,
    usedMemBytes: 64 * 1024 ** 3,
    ...overrides,
  };
}

describe("NodePoolSummary", () => {
  it("shows an empty state when there are no NodePools", () => {
    render(<NodePoolSummary rows={[]} />);
    expect(screen.getByText(/no nodepools/i)).toBeTruthy();
  });

  it("lists a NodePool's node count, pod count, and spot/on-demand mix", () => {
    render(<NodePoolSummary rows={[row()]} />);
    expect(screen.getByText("default")).toBeTruthy();
    expect(screen.getByText(/5 nodes?/i)).toBeTruthy();
    expect(screen.getByText(/3 spot/i)).toBeTruthy();
    expect(screen.getByText(/2 on-demand/i)).toBeTruthy();
  });

  it("shows current resources against limits", () => {
    render(<NodePoolSummary rows={[row()]} />);
    expect(screen.getByText(/32\.00.*1000\.00/)).toBeTruthy();
  });

  it("handles a NodePool with no limits set", () => {
    render(<NodePoolSummary rows={[row({ limitCpuMillis: undefined, limitMemBytes: undefined })]} />);
    expect(screen.getByText(/no limit/i)).toBeTruthy();
  });
});
