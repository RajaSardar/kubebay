import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkloadUsageTable } from "../WorkloadUsageTable";
import type { RightSizingRow } from "../../lib/rightsizing";

function row(overrides: Partial<RightSizingRow> = {}): RightSizingRow {
  return {
    ns: "default",
    workloadKind: "Deployment",
    workloadName: "app",
    container: "(all containers)",
    replicas: 3,
    vpaName: "",
    vpaUpdateMode: "",
    currentCpuMillis: 1500,
    currentMemBytes: 1536 * 1024 * 1024,
    targetCpuMillis: 300,
    targetMemBytes: 512 * 1024 * 1024,
    wastedCpuMillis: 1200,
    wastedMemBytes: 1024 * 1024 * 1024,
    cpuMaterial: true,
    memMaterial: true,
    material: true,
    hpaCpuConflict: false,
    gitopsOwner: null,
    source: "metrics-server",
    window: "observed over 3h, 180 samples",
    ...overrides,
  };
}

describe("WorkloadUsageTable", () => {
  it("shows an empty state when there is no usage data yet", () => {
    render(<WorkloadUsageTable rows={[]} />);
    expect(screen.getByText(/no usage-based recommendations/i)).toBeTruthy();
  });

  it("lists a workload's requested vs p95 usage and its observation window", () => {
    render(<WorkloadUsageTable rows={[row()]} />);
    expect(screen.getByText("app")).toBeTruthy();
    expect(screen.getByText(/1\.50/)).toBeTruthy();
    expect(screen.getByText(/observed over 3h, 180 samples/i)).toBeTruthy();
  });
});
