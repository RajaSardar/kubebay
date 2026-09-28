import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WasteBreakdown } from "../WasteBreakdown";
import type { ClusterWaste } from "../../lib/waste";

function waste(overrides: Partial<ClusterWaste> = {}): ClusterWaste {
  return {
    nodes: [
      {
        name: "node-1",
        allocatableCpuMillis: 4000,
        allocatableMemBytes: 16 * 1024 ** 3,
        requestedCpuMillis: 1000,
        requestedMemBytes: 4 * 1024 ** 3,
        idleCpuMillis: 3000,
        idleMemBytes: 12 * 1024 ** 3,
        systemOverheadCpuMillis: 200,
        systemOverheadMemBytes: 256 * 1024 ** 2,
        byNamespace: [{ ns: "team-a", cpuMillis: 1000, memBytes: 4 * 1024 ** 3 }],
      },
    ],
    totalIdleCpuMillis: 3000,
    totalIdleMemBytes: 12 * 1024 ** 3,
    totalSystemOverheadCpuMillis: 200,
    totalSystemOverheadMemBytes: 256 * 1024 ** 2,
    byNamespace: [{ ns: "team-a", cpuMillis: 1000, memBytes: 4 * 1024 ** 3 }],
    unrequestedContainers: [],
    ...overrides,
  };
}

describe("WasteBreakdown", () => {
  it("shows total idle capacity as its own top-level line", () => {
    render(<WasteBreakdown waste={waste()} />);
    expect(screen.getAllByText(/idle/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3\.00/).length).toBeGreaterThan(0); // 3000m -> "3.00" cores
  });

  it("shows system overhead separately from any namespace", () => {
    render(<WasteBreakdown waste={waste()} />);
    expect(screen.getAllByText(/system overhead/i).length).toBeGreaterThan(0);
  });

  it("lists per-namespace requested totals", () => {
    render(<WasteBreakdown waste={waste()} />);
    expect(screen.getByText("team-a")).toBeTruthy();
  });

  it("lists per-node allocatable/requested/idle", () => {
    render(<WasteBreakdown waste={waste()} />);
    expect(screen.getByText("node-1")).toBeTruthy();
  });

  it("warns about containers with no requests set", () => {
    const w = waste({ unrequestedContainers: [{ ns: "team-a", pod: "p1", container: "c1", node: "node-1" }] });
    render(<WasteBreakdown waste={w} />);
    expect(screen.getByText(/no resource requests/i)).toBeTruthy();
    expect(screen.getByText(/c1/)).toBeTruthy();
  });

  it("does not render an unrequested-containers warning when there are none", () => {
    render(<WasteBreakdown waste={waste()} />);
    expect(screen.queryByText(/no resource requests/i)).toBeNull();
  });

  it("never shows a dollar sign by default", () => {
    render(<WasteBreakdown waste={waste()} />);
    expect(screen.queryByText(/\$/)).toBeNull();
  });
});
