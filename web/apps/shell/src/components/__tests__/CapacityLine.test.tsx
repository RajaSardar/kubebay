import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CapacityLine } from "../CapacityLine";
import type { ClusterCapacity } from "../../lib/capacity";

const GI = 1024 ** 3;
const cap: ClusterCapacity = {
  cpu: { requested: 750, allocatable: 4000, pct: 19, over: false },
  memory: { requested: 3.5 * GI, allocatable: 4 * GI, pct: 88, over: true },
};

describe("CapacityLine", () => {
  it("says in one line how much of the cluster is requested", () => {
    render(<CapacityLine capacity={cap} />);
    const section = screen.getByRole("region", { name: "Capacity" });
    expect(within(section).getByText("CPU 19% · memory 88% requested of allocatable")).toBeInTheDocument();
    expect(within(section).getByText("Memory is nearly full")).toBeInTheDocument();
  });

  it("opens into bars with the amounts, and shows use only when metrics exist", () => {
    render(<CapacityLine capacity={{ ...cap, cpu: { ...cap.cpu, used: 300 } }} />);
    const toggle = screen.getByRole("button", { name: "Show bars" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/of 4.00 core requested/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide bars" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("CPU: 750m of 4.00 core requested · 300m used")).toBeInTheDocument();
    expect(screen.getByText("Memory: 3.5Gi of 4.0Gi requested")).toBeInTheDocument();
  });

  it("draws nothing without nodes to measure", () => {
    const { container } = render(<CapacityLine capacity={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
