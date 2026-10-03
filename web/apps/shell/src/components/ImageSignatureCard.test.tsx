import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ImageSignatureCard } from "./ImageSignatureCard";

describe("ImageSignatureCard", () => {
  it("says no engine is installed when neither Kyverno nor Sigstore policy-controller is present", () => {
    render(<ImageSignatureCard enginesInstalled={false} report={{ status: "none", policies: [], sigstoreNamespaces: [], namespaces: [], uncovered: [] }} />);
    expect(screen.getByText(/no signature-verification engine installed/i)).toBeTruthy();
  });

  it("warns that nothing is verified when an engine exists but has no signature policies", () => {
    render(<ImageSignatureCard enginesInstalled report={{ status: "none", policies: [], sigstoreNamespaces: [], namespaces: [], uncovered: [] }} />);
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
          namespaces: [],
          uncovered: [],
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
          namespaces: [],
          uncovered: [],
        }}
      />,
    );
    expect(screen.getByText(/^enforced$/i)).toBeTruthy();
    expect(screen.getByText(/shop, payments/)).toBeTruthy();
  });

  it("shows the CIS and ATT&CK controls image provenance maps to", () => {
    render(<ImageSignatureCard enginesInstalled={false} report={{ status: "none", policies: [], sigstoreNamespaces: [], namespaces: [], uncovered: [] }} />);
    expect(screen.getByText("CIS 5.5.1")).toBeTruthy();
    expect(screen.getByText("ATT&CK T1525")).toBeTruthy();
  });

  it("says where enforcement stops when it covers only some namespaces", () => {
    render(
      <ImageSignatureCard
        enginesInstalled
        report={{
          status: "partial",
          policies: [{ engine: "kyverno", name: "verify", mode: "enforce", images: ["*"] }],
          sigstoreNamespaces: [],
          namespaces: [
            { name: "shop", mode: "enforce", system: false },
            { name: "dev", mode: "audit", system: false },
            { name: "legacy", mode: "none", system: false },
            { name: "kube-system", mode: "none", system: true },
          ],
          uncovered: ["dev", "legacy"],
        }}
      />,
    );
    expect(screen.getByText(/partly enforced/i)).toBeTruthy();
    expect(screen.getByText("Enforced in 1 of 3 namespaces (system namespaces aside).")).toBeTruthy();
    expect(screen.getByText(/Unsigned images can run in: dev \(audit only\), legacy/)).toBeTruthy();
  });

  it("names Ratify and Connaisseur policies", () => {
    render(
      <ImageSignatureCard
        enginesInstalled
        report={{
          status: "enforced",
          policies: [
            { engine: "ratify", name: "verify-prod", mode: "enforce", images: [] },
            { engine: "connaisseur", name: "connaisseur-webhook", mode: "enforce", images: [] },
          ],
          sigstoreNamespaces: [],
          namespaces: [],
          uncovered: [],
        }}
      />,
    );
    expect(screen.getByText("ratify")).toBeTruthy();
    expect(screen.getByText("connaisseur")).toBeTruthy();
    expect(screen.getByText(/Connaisseur keeps its rules in a ConfigMap/)).toBeTruthy();
  });
});
