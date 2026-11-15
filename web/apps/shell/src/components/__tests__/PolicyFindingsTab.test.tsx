import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PolicyFindingsSummary } from "../PolicyFindingsTab";
import type { PolicyFinding } from "../../lib/policyFindings";

function finding(overrides: Partial<PolicyFinding> = {}): PolicyFinding {
  return {
    policy: "require-labels",
    rule: "check-team-label",
    result: "fail",
    message: "validation error: label 'team' is required",
    severity: "medium",
    reportName: "polr-default",
    ...overrides,
  };
}

describe("PolicyFindingsSummary", () => {
  it("shows a clean state when there are no findings at all", () => {
    render(<PolicyFindingsSummary findings={[]} />);
    expect(screen.getByText(/no policy findings/i)).toBeTruthy();
  });

  it("lists failing/warning/erroring findings individually with their message", () => {
    render(<PolicyFindingsSummary findings={[finding()]} />);
    expect(screen.getByText("check-team-label")).toBeTruthy();
    expect(screen.getByText(/label 'team' is required/)).toBeTruthy();
  });

  it("summarizes passing findings as a count instead of listing each one", () => {
    const findings = [
      finding({ rule: "r1", result: "pass" }),
      finding({ rule: "r2", result: "pass" }),
      finding({ rule: "r3", result: "fail", message: "bad" }),
    ];
    render(<PolicyFindingsSummary findings={findings} />);
    expect(screen.getByText(/2 checks? passed/i)).toBeTruthy();
    expect(screen.queryByText("r1")).toBeNull();
    expect(screen.getByText("r3")).toBeTruthy();
  });

  it("shows an all-clear state when every finding passed", () => {
    render(<PolicyFindingsSummary findings={[finding({ result: "pass" })]} />);
    expect(screen.getByText(/1 check passed/i)).toBeTruthy();
    expect(screen.queryByText(/label 'team'/)).toBeNull();
  });
});
