import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunningImageSignaturesCard } from "../RunningImageSignaturesCard";
import { imageSigApi, type ImageSignatureRow } from "../../lib/api";

vi.mock("../../lib/api", () => ({ imageSigApi: { check: vi.fn() } }));

const rows: ImageSignatureRow[] = [
  { image: "ghcr.io/org/web:1", digest: "sha256:aa", status: "signed", method: "cosign tag", verification: "verified", verifiedBy: "Kyverno ClusterPolicy verify-acme", pods: 3, namespaces: ["ops", "shop"] },
  { image: "nginx:1.27", digest: "sha256:bb", status: "unsigned", reason: "no cosign signature tag or signature referrer for this digest", pods: 1, namespaces: ["shop"] },
  { image: "registry.corp/app:2", digest: "sha256:cc", status: "unknown", reason: "registry requires credentials; Kubebay only checks anonymously", pods: 2, namespaces: ["shop"] },
];

describe("RunningImageSignaturesCard", () => {
  beforeEach(() => {
    vi.mocked(imageSigApi.check).mockReset();
  });

  it("does nothing until asked, and says registries are contacted anonymously unless chosen otherwise", () => {
    render(<RunningImageSignaturesCard cluster="c1" />);
    expect(screen.getByText(/anonymously unless you choose the pods' pull secrets/i)).toBeInTheDocument();
    expect(imageSigApi.check).not.toHaveBeenCalled();
  });

  it("lists each running image's signature status after a check", async () => {
    vi.mocked(imageSigApi.check).mockResolvedValue(rows);
    render(<RunningImageSignaturesCard cluster="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(await screen.findByText("1 with a signature")).toBeInTheDocument();
    expect(screen.getByText("1 without")).toBeInTheDocument();
    expect(screen.getByText("1 unknown")).toBeInTheDocument();
    expect(screen.getByText("signature found (cosign tag)")).toBeInTheDocument();
    expect(screen.getByText(/registry requires credentials/)).toBeInTheDocument();
    expect(screen.getByText("verified by Kyverno ClusterPolicy verify-acme")).toBeInTheDocument();
    expect(screen.getByText(/keyless signature is checked against Sigstore's public trust roots/i)).toBeInTheDocument();
    expect(imageSigApi.check).toHaveBeenCalledWith("c1", false);
  });

  it("shows a failed check", async () => {
    vi.mocked(imageSigApi.check).mockRejectedValue(new Error("connect: refused"));
    render(<RunningImageSignaturesCard cluster="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(await screen.findByText(/connect: refused/)).toBeInTheDocument();
  });

  it("says what verification against the policy keys concluded", async () => {
    vi.mocked(imageSigApi.check).mockResolvedValue([
      { image: "a:1", digest: "sha256:1", status: "signed", verification: "failed", reason: "no signature verifies with the policy keys", pods: 1, namespaces: ["x"] },
      { image: "b:1", digest: "sha256:2", status: "signed", verification: "keyless", pods: 1, namespaces: ["x"] },
      { image: "c:1", digest: "sha256:3", status: "signed", verification: "no-key", pods: 1, namespaces: ["x"] },
    ]);
    render(<RunningImageSignaturesCard cluster="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(await screen.findByText("verification failed")).toBeInTheDocument();
    expect(screen.getByText("no signature verifies with the policy keys")).toBeInTheDocument();
    expect(screen.getByText("keyless, not checked")).toBeInTheDocument();
    expect(screen.getByText("no policy key for this image")).toBeInTheDocument();
  });

  it("names the keyless signer Sigstore's roots verified", async () => {
    vi.mocked(imageSigApi.check).mockResolvedValue([
      { image: "a:1", digest: "sha256:1", status: "signed", verification: "verified", verifiedBy: "Kyverno ClusterPolicy release", signer: "release@acme.dev", issuer: "https://accounts.google.com", pods: 1, namespaces: ["x"] },
      { image: "b:1", digest: "sha256:2", status: "signed", verification: "keyless", signer: "https://github.com/acme/app/.github/workflows/release.yml@refs/tags/v1", issuer: "https://token.actions.githubusercontent.com", reason: "signature verified against Sigstore's public roots; no policy names a signer for this image", pods: 1, namespaces: ["x"] },
      { image: "c:1", digest: "sha256:3", status: "signed", verification: "failed", signer: "mallory@evil.dev", issuer: "https://accounts.google.com", reason: "signed by mallory@evil.dev (issuer https://accounts.google.com), which no policy identity for this image allows", pods: 1, namespaces: ["x"] },
    ]);
    render(<RunningImageSignaturesCard cluster="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(await screen.findByText("verified by Kyverno ClusterPolicy release")).toBeInTheDocument();
    expect(screen.getByText("release@acme.dev")).toBeInTheDocument();
    expect(screen.getByText("verified, no policy identity")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/acme/app/.github/workflows/release.yml@refs/tags/v1")).toBeInTheDocument();
    expect(screen.getByText(/no policy names a signer/)).toBeInTheDocument();
    expect(screen.getByText(/which no policy identity for this image allows/)).toBeInTheDocument();
  });

  it("uses the pods' pull secrets only when chosen", async () => {
    vi.mocked(imageSigApi.check).mockResolvedValue(rows);
    render(<RunningImageSignaturesCard cluster="c1" />);
    fireEvent.change(screen.getByLabelText("Registry access"), { target: { value: "pull-secrets" } });
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    await screen.findByText("1 with a signature");
    expect(imageSigApi.check).toHaveBeenCalledWith("c1", true);
  });
});
