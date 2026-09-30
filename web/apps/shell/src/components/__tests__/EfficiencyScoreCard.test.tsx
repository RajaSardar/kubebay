import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EfficiencyScoreCard } from "../EfficiencyScoreCard";
import type { EfficiencyScore } from "../../lib/efficiencyScore";

const scored: EfficiencyScore = {
  score: 64,
  grade: "fair",
  components: [
    { key: "provisioning", label: "Provisioning", score: 50, detail: "40% of CPU and 40% of memory requested (target 80%)" },
    { key: "coverage", label: "Request coverage", score: 100, detail: "4 of 4 containers set resource requests" },
  ],
  missing: ["optimization"],
};

describe("EfficiencyScoreCard", () => {
  it("shows the overall score out of 100 with its grade", () => {
    render(<EfficiencyScoreCard efficiency={scored} />);
    expect(screen.getByText("64")).toBeInTheDocument();
    expect(screen.getByText("/ 100")).toBeInTheDocument();
    expect(screen.getByText("Fair")).toBeInTheDocument();
  });

  it("lists each component with its score and what it measured", () => {
    render(<EfficiencyScoreCard efficiency={scored} />);
    expect(screen.getByText("Provisioning")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText(/4 of 4 containers/)).toBeInTheDocument();
  });

  it("says when workload sizing was left out for lack of usage data", () => {
    render(<EfficiencyScoreCard efficiency={scored} />);
    expect(screen.getByText(/Workload sizing isn't scored/)).toBeInTheDocument();
  });

  it("says there is nothing to score for a cluster with no capacity", () => {
    render(<EfficiencyScoreCard efficiency={{ score: null, grade: null, components: [], missing: [] }} />);
    expect(screen.getByText(/No allocatable capacity to score/)).toBeInTheDocument();
  });
});
