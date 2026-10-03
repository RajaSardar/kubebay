import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SecretExposureCard } from "./SecretExposureCard";
import type { SecretExposureFinding } from "../lib/secretExposure";

const finding = (over: Partial<SecretExposureFinding> = {}): SecretExposureFinding => ({
  namespace: "shop",
  appLabel: "cart",
  podCount: 2,
  secretNames: ["db-creds"],
  ...over,
});

describe("SecretExposureCard", () => {
  it("shows an all-clear message when there are no findings", () => {
    render(<SecretExposureCard findings={[]} />);
    expect(screen.getByText(/no workloads expose secrets via environment variables/i)).toBeTruthy();
  });

  it("lists each finding with namespace, app label, pod count, and secret names", () => {
    render(<SecretExposureCard findings={[finding()]} />);
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("cart")).toBeTruthy();
    expect(screen.getByText(/2 pods?/i)).toBeTruthy();
    expect(screen.getByText("db-creds")).toBeTruthy();
  });

  it("lists multiple secret names for the same finding", () => {
    render(<SecretExposureCard findings={[finding({ secretNames: ["db-creds", "api-key"] })]} />);
    expect(screen.getByText("db-creds")).toBeTruthy();
    expect(screen.getByText("api-key")).toBeTruthy();
  });

  it("shows the CIS control the finding maps to", () => {
    render(<SecretExposureCard findings={[finding()]} />);
    expect(screen.getByText("CIS 5.4.1")).toBeTruthy();
  });
});
