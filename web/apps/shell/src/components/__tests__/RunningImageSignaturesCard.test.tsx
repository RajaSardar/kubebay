import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RunningImageSignaturesCard } from "../RunningImageSignaturesCard";
import { imageSigApi, type ImageSignatureRow } from "../../lib/api";

vi.mock("../../lib/api", () => ({ imageSigApi: { check: vi.fn() } }));

const rows: ImageSignatureRow[] = [
  { image: "ghcr.io/org/web:1", digest: "sha256:aa", status: "signed", method: "cosign tag", pods: 3, namespaces: ["ops", "shop"] },
  { image: "nginx:1.27", digest: "sha256:bb", status: "unsigned", reason: "no cosign signature tag or signature referrer for this digest", pods: 1, namespaces: ["shop"] },
  { image: "registry.corp/app:2", digest: "sha256:cc", status: "unknown", reason: "registry requires credentials; Kubebay only checks anonymously", pods: 2, namespaces: ["shop"] },
];

describe("RunningImageSignaturesCard", () => {
  beforeEach(() => {
    vi.mocked(imageSigApi.check).mockReset();
  });

  it("does nothing until asked, and says it will contact registries anonymously", () => {
    render(<RunningImageSignaturesCard cluster="c1" />);
    expect(screen.getByText(/contacts each image's registry anonymously/i)).toBeInTheDocument();
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
    expect(screen.getByText(/not verified against a key/i)).toBeInTheDocument();
    expect(imageSigApi.check).toHaveBeenCalledWith("c1");
  });

  it("shows a failed check", async () => {
    vi.mocked(imageSigApi.check).mockRejectedValue(new Error("connect: refused"));
    render(<RunningImageSignaturesCard cluster="c1" />);
    fireEvent.click(screen.getByRole("button", { name: "Check signatures" }));
    expect(await screen.findByText(/connect: refused/)).toBeInTheDocument();
  });
});
