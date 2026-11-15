import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { UpgradeReadinessPanel } from "./UpgradeReadinessPanel";
import type { UpgradeReadinessFinding } from "../lib/upgradeReadiness";

const finding = (over: Partial<UpgradeReadinessFinding> = {}): UpgradeReadinessFinding => ({
  kind: "PodDisruptionBudget",
  apiVersion: "policy/v1beta1",
  replacementVersion: "policy/v1",
  removedInMinor: 25,
  minorsAway: 1,
  ...over,
});

describe("UpgradeReadinessPanel", () => {
  it("shows an all-clear empty state when there are no findings", () => {
    render(<UpgradeReadinessPanel findings={[]} serverVersion="v1.28.0" />);
    expect(screen.getByText(/no soon-to-be-removed/i)).toBeTruthy();
  });

  it("lists each finding with its apiVersion, replacement, and removal target", () => {
    render(<UpgradeReadinessPanel findings={[finding()]} serverVersion="v1.24.0" />);
    expect(screen.getByText("PodDisruptionBudget")).toBeTruthy();
    expect(screen.getByText("policy/v1beta1")).toBeTruthy();
    expect(screen.getByText("policy/v1")).toBeTruthy();
    expect(screen.getByText(/1\.25/)).toBeTruthy();
  });

  it("marks a finding already past its removal minor as most urgent (err tone)", () => {
    render(<UpgradeReadinessPanel findings={[finding({ minorsAway: -1 })]} serverVersion="v1.26.0" />);
    expect(screen.getByText(/overdue/i)).toBeTruthy();
  });

  it("renders multiple findings, most urgent first as passed in", () => {
    const findings = [finding({ kind: "PodDisruptionBudget", minorsAway: 0 }), finding({ kind: "CronJob", apiVersion: "batch/v1beta1", minorsAway: 2 })];
    render(<UpgradeReadinessPanel findings={findings} serverVersion="v1.23.0" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("PodDisruptionBudget");
    expect(items[1]?.textContent).toContain("CronJob");
  });
});
