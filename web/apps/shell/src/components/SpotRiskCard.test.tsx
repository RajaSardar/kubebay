import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpotRiskCard } from "./SpotRiskCard";

describe("SpotRiskCard", () => {
  it("says so when the cluster has no spot nodes", () => {
    render(<SpotRiskCard findings={[]} spotNodeCount={0} />);
    expect(screen.getByText(/no spot or preemptible nodes/i)).toBeTruthy();
  });

  it("shows an all-clear when there are spot nodes but no risky workloads", () => {
    render(<SpotRiskCard findings={[]} spotNodeCount={3} />);
    expect(screen.getByText(/every workload on spot capacity can tolerate a reclaim/i)).toBeTruthy();
  });

  it("lists findings with a reason label", () => {
    render(
      <SpotRiskCard
        spotNodeCount={2}
        findings={[
          { namespace: "shop", appLabel: "cart", podCount: 1, reason: "single-replica-on-spot" },
          { namespace: "shop", appLabel: "web", podCount: 3, reason: "no-pdb-on-spot" },
        ]}
      />,
    );
    expect(screen.getByText("cart")).toBeTruthy();
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.getByText(/single replica/i)).toBeTruthy();
    expect(screen.getByText(/no pdb/i)).toBeTruthy();
  });
});
