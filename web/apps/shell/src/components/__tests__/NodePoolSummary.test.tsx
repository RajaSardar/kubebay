import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NodePoolSummary } from "../NodePoolSummary";
import type { NodePoolRow } from "../../lib/karpenter";

vi.mock("../NodePoolEditor", () => ({
  NodePoolEditor: ({ name }: { name: string }) => <div data-testid="nodepool-editor">editing {name}</div>,
}));

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

const streams = { cluster: "kind-test", gvr: "karpenter.sh/v1/nodepools", nodes: [], pods: [], pdbs: [] };

describe("NodePoolSummary", () => {
  it("shows an empty state when there are no NodePools", () => {
    render(<NodePoolSummary rows={[]} {...streams} />);
    expect(screen.getByText(/no nodepools/i)).toBeTruthy();
  });

  it("lists a NodePool's node count, pod count, and spot/on-demand mix", () => {
    render(<NodePoolSummary rows={[row()]} {...streams} />);
    expect(screen.getByText("default")).toBeTruthy();
    expect(screen.getByText(/5 nodes?/i)).toBeTruthy();
    expect(screen.getByText(/3 spot/i)).toBeTruthy();
    expect(screen.getByText(/2 on-demand/i)).toBeTruthy();
  });

  it("shows current resources against limits", () => {
    render(<NodePoolSummary rows={[row()]} {...streams} />);
    expect(screen.getByText(/32\.00.*1000\.00/)).toBeTruthy();
  });

  it("handles a NodePool with no limits set", () => {
    render(<NodePoolSummary rows={[row({ limitCpuMillis: undefined, limitMemBytes: undefined })]} {...streams} />);
    expect(screen.getByText(/no limit/i)).toBeTruthy();
  });

  it("does not show the editor until Edit is clicked", () => {
    render(<NodePoolSummary rows={[row()]} {...streams} />);
    expect(screen.queryByTestId("nodepool-editor")).toBeNull();
  });

  it("expands the editor for the clicked NodePool, and collapses it on a second click", () => {
    render(<NodePoolSummary rows={[row()]} {...streams} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByTestId("nodepool-editor").textContent).toBe("editing default");

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByTestId("nodepool-editor")).toBeNull();
  });
});
