import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NetworkPolicyCoverageList } from "./NetworkPolicyCoverageList";
import type { CoverageGap } from "../lib/networkPolicyCoverage";

const gap = (over: Partial<CoverageGap> = {}): CoverageGap => ({
  namespace: "shop",
  appLabel: "cart",
  podCount: 2,
  reason: "no-policy-in-namespace",
  ...over,
});

describe("NetworkPolicyCoverageList", () => {
  it("shows an all-covered empty state when there are no gaps", () => {
    render(<NetworkPolicyCoverageList gaps={[]} />);
    expect(screen.getByText(/every workload has NetworkPolicy coverage/i)).toBeTruthy();
  });

  it("lists each gap with its namespace, app label, and pod count", () => {
    render(<NetworkPolicyCoverageList gaps={[gap()]} />);
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("cart")).toBeTruthy();
    expect(screen.getByText(/2 pods?/i)).toBeTruthy();
  });

  it("distinguishes a namespace-wide gap from a partial-coverage gap", () => {
    render(<NetworkPolicyCoverageList gaps={[gap({ reason: "no-policy-in-namespace" }), gap({ appLabel: "checkout", reason: "not-selected-by-any-policy" })]} />);
    expect(screen.getByText(/no policy in namespace/i)).toBeTruthy();
    expect(screen.getByText(/not covered by any policy/i)).toBeTruthy();
  });

  it("tags each gap with CIS 5.3.2", () => {
    render(<NetworkPolicyCoverageList gaps={[gap()]} />);
    expect(screen.getByText("CIS 5.3.2")).toBeTruthy();
  });
});
