import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FleetShowbackTable } from "../FleetShowbackTable";

describe("FleetShowbackTable", () => {
  it("shows one row per namespace with the clusters it spans", () => {
    render(
      <FleetShowbackTable
        rows={[
          {
            ns: "payments", clusters: ["prod", "staging"], workloads: 2,
            requestedCpuMillis: 1500, requestedMemBytes: 0, p95CpuMillis: 500, p95MemBytes: 0, wastedCpuMillis: 900, wastedMemBytes: 0,
          },
        ]}
      />,
    );
    expect(screen.getByText("payments")).toBeInTheDocument();
    expect(screen.getByText("prod, staging")).toBeInTheDocument();
  });

  it("says why it's empty when no cluster reports usage", () => {
    render(<FleetShowbackTable rows={[]} />);
    expect(screen.getByText(/no usage data/i)).toBeInTheDocument();
  });
});
