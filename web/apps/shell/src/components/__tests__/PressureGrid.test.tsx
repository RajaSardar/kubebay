import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PressureGrid } from "../PressureGrid";
import type { PressureGrid as PressureGridData } from "../../lib/pressure";

function grid(overrides: Partial<PressureGridData> = {}): PressureGridData {
  return {
    namespaces: ["team-a", "team-b"],
    nodes: ["node-1", "node-2"],
    cells: [
      { ns: "team-a", node: "node-1", requestedCpuMillis: 1000, requestedMemBytes: 1024 ** 3, usedCpuMillis: 0, usedMemBytes: 0, bestEffortCount: 0, podCount: 2 },
    ],
    nodeAllocatable: { "node-1": { cpuMillis: 4000, memBytes: 16 * 1024 ** 3 }, "node-2": { cpuMillis: 4000, memBytes: 16 * 1024 ** 3 } },
    hasUsageData: false,
    otherNamespacesCount: 0,
    otherNodesCount: 0,
    otherNamespacesLabel: "+0 others",
    otherNodesLabel: "+0 others",
    ...overrides,
  };
}

describe("PressureGrid", () => {
  it("renders a row label per namespace and a column label per node", () => {
    render(<PressureGrid grid={grid()} />);
    expect(screen.getByText("team-a")).toBeTruthy();
    expect(screen.getByText("team-b")).toBeTruthy();
    expect(screen.getByText("node-1")).toBeTruthy();
    expect(screen.getByText("node-2")).toBeTruthy();
  });

  it("shows a requests-only banner when there is no usage data, never a blank grid", () => {
    render(<PressureGrid grid={grid({ hasUsageData: false })} />);
    expect(screen.getByText(/requests.only/i)).toBeTruthy();
    // The grid itself must still render even without usage data.
    expect(screen.getByText("team-a")).toBeTruthy();
  });

  it("does not show the requests-only banner once usage data is available", () => {
    render(<PressureGrid grid={grid({ hasUsageData: true })} />);
    expect(screen.queryByText(/requests.only/i)).toBeNull();
  });

  it("shows an empty state when there is nothing to plot", () => {
    render(<PressureGrid grid={grid({ namespaces: [], nodes: [], cells: [] })} />);
    expect(screen.getByText(/no pods scheduled/i)).toBeTruthy();
  });

  it("marks a cell with BestEffort pods distinctly", () => {
    const g = grid({
      cells: [
        { ns: "team-a", node: "node-1", requestedCpuMillis: 0, requestedMemBytes: 0, usedCpuMillis: 0, usedMemBytes: 0, bestEffortCount: 3, podCount: 3 },
      ],
    });
    const { container } = render(<PressureGrid grid={g} />);
    expect(container.querySelector('[data-besteffort="true"]')).toBeTruthy();
  });
});
