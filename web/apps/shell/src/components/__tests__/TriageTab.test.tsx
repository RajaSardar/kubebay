import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TriageTab } from "../TriageTab";
import { triageApi, type TriagePreview } from "../../lib/api";

const preview: TriagePreview = {
  endpoint: "https://api.anthropic.com/v1/messages",
  request: {
    model: "claude-opus-5-5",
    max_tokens: 2048,
    system: "Use only the evidence in the bundle. Cite the IDs.",
    messages: [{ role: "user", content: "Cluster kind-dev, pod shop/api-7d9-x.\n\n[E1] Pod shop/api-7d9-x\nphase: Running\n" }],
  },
  evidence: {
    cluster: "kind-dev",
    namespace: "shop",
    pod: "api-7d9-x",
    masked: 3,
    truncated: true,
    sections: [
      { id: "E1", title: "Pod shop/api-7d9-x", text: "phase: Running" },
      { id: "E2", title: "Logs of api (previous run, exited 2: Error)", text: "panic: nil map  (×3)" },
    ],
  },
  approxTokens: 812,
  keySource: "keychain",
};

vi.mock("../../lib/api", () => ({ triageApi: { preview: vi.fn() } }));

describe("TriageTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triageApi.preview).mockResolvedValue(preview);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads nothing until asked", () => {
    render(<TriageTab cluster="kind-dev" namespace="shop" pod="api-7d9-x" />);
    expect(screen.getByRole("button", { name: "Gather evidence" })).toBeInTheDocument();
    expect(triageApi.preview).not.toHaveBeenCalled();
  });

  it("shows exactly what would be sent, section by section", async () => {
    render(<TriageTab cluster="kind-dev" namespace="shop" pod="api-7d9-x" />);
    fireEvent.click(screen.getByRole("button", { name: "Gather evidence" }));
    await waitFor(() => expect(triageApi.preview).toHaveBeenCalledWith({ cluster: "kind-dev", namespace: "shop", pod: "api-7d9-x" }));
    expect(await screen.findByText("https://api.anthropic.com/v1/messages")).toBeInTheDocument();
    expect(screen.getByText("claude-opus-5-5")).toBeInTheDocument();
    expect(screen.getByText(/about 812 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/3 values masked/)).toBeInTheDocument();
    expect(screen.getByText(/logs were cut to fit/i)).toBeInTheDocument();
    expect(screen.getByText("Logs of api (previous run, exited 2: Error)")).toBeInTheDocument();
    expect(screen.getByText(/panic: nil map\s+\(×3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Use only the evidence in the bundle/)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been sent/i)).toBeInTheDocument();
  });

  it("copies the evidence for the assistant you use", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<TriageTab cluster="kind-dev" namespace="shop" pod="api-7d9-x" />);
    fireEvent.click(screen.getByRole("button", { name: "Gather evidence" }));
    fireEvent.click(await screen.findByRole("button", { name: "Copy evidence" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.request.messages[0]!.content));
  });

  it("shows why evidence couldn't be gathered", async () => {
    vi.mocked(triageApi.preview).mockRejectedValueOnce(new Error('incident triage isn\'t allowed for cluster "prod": add it in Settings'));
    render(<TriageTab cluster="prod" namespace="shop" pod="api-7d9-x" />);
    fireEvent.click(screen.getByRole("button", { name: "Gather evidence" }));
    expect(await screen.findByText(/add it in Settings/)).toBeInTheDocument();
  });
});
