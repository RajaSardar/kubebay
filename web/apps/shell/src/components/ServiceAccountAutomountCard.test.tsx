import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ServiceAccountAutomountCard } from "./ServiceAccountAutomountCard";
import type { AutomountFinding } from "../lib/serviceAccountAutomount";

const finding = (over: Partial<AutomountFinding> = {}): AutomountFinding => ({
  namespace: "shop",
  appLabel: "cart",
  podCount: 3,
  ...over,
});

describe("ServiceAccountAutomountCard", () => {
  it("shows an all-clear message when there are no findings", () => {
    render(<ServiceAccountAutomountCard findings={[]} />);
    expect(screen.getByText(/no workloads auto-mount the default ServiceAccount token/i)).toBeTruthy();
  });

  it("lists each finding with namespace, app label, and pod count", () => {
    render(<ServiceAccountAutomountCard findings={[finding()]} />);
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("cart")).toBeTruthy();
    expect(screen.getByText(/3 pods?/i)).toBeTruthy();
  });

  it("shows the CIS and ATT&CK controls the finding maps to", () => {
    render(<ServiceAccountAutomountCard findings={[finding()]} />);
    expect(screen.getByText("CIS 5.1.6")).toBeTruthy();
    expect(screen.getByText("ATT&CK T1528")).toBeTruthy();
  });
});
