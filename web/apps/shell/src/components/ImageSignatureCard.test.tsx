import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImageSignatureCard } from "./ImageSignatureCard";

describe("ImageSignatureCard", () => {
  it("says no engine is installed when neither Kyverno nor Sigstore policy-controller is present", () => {
    render(<ImageSignatureCard enginesInstalled={false} report={{ status: "none", policies: [], sigstoreNamespaces: [] }} />);
    expect(screen.getByText(/no signature-verification engine installed/i)).toBeTruthy();
  });

  it("warns that nothing is verified when an engine exists but has no signature policies", () => {
    render(<ImageSignatureCard enginesInstalled report={{ status: "none", policies: [], sigstoreNamespaces: [] }} />);
    expect(screen.getByText(/no policy verifies image signatures/i)).toBeTruthy();
  });

  it("labels audit-only and lists each policy with its mode and images", () => {
    render(
      <ImageSignatureCard
        enginesInstalled
        report={{
          status: "audit-only",
          policies: [{ engine: "kyverno", name: "verify-acme", mode: "audit", images: ["ghcr.io/acme/*"] }],
          sigstoreNamespaces: [],
        }}
      />,
    );
    expect(screen.getByText(/audit only/i)).toBeTruthy();
    expect(screen.getByText("verify-acme")).toBeTruthy();
    expect(screen.getByText("ghcr.io/acme/*")).toBeTruthy();
  });

  it("shows enforced and the Sigstore opted-in namespaces", () => {
    render(
      <ImageSignatureCard
        enginesInstalled
        report={{
          status: "enforced",
          policies: [{ engine: "sigstore", name: "acme", mode: "enforce", images: ["ghcr.io/acme/**"] }],
          sigstoreNamespaces: ["shop", "payments"],
        }}
      />,
    );
    expect(screen.getByText(/^enforced$/i)).toBeTruthy();
    expect(screen.getByText(/shop, payments/)).toBeTruthy();
  });
});
