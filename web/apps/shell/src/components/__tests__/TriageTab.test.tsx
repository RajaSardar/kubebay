import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { TriageTab } from "../TriageTab";
import { triageApi, type TriagePreview, type TriageResult } from "../../lib/api";

const preview: TriagePreview = {
  previewId: "p-1",
  expires: "2026-10-12T10:10:00Z",
  endpoint: "https://api.anthropic.com/v1/messages",
  request: {
    model: "claude-opus-5-5",
    max_tokens: 16000,
    system: [{ type: "text", text: "Use only the evidence in the bundle. Cite the IDs." }],
    messages: [{ role: "user", content: [{ type: "text", text: "Cluster kind-dev, pod shop/api-7d9-x.\n\n[E1] Pod shop/api-7d9-x\nphase: Running\n" }] }],
  },
  betas: ["server-side-fallback-2026-07-01"],
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

const result: TriageResult = {
  summary: "api crashes on start: a nil map write panics.",
  findings: [
    {
      title: "nil map panic at startup",
      likelihood: "likely",
      explanation: "The previous run panicked writing to a nil map.",
      evidence: ["E2"],
      nextSteps: ["Check the config the new image reads"],
    },
  ],
  dropped: 1,
  missingEvidence: "the config file the app loads",
  model: "claude-opus-5-5",
  inputTokens: 900,
  outputTokens: 120,
};

vi.mock("../../lib/api", () => ({ triageApi: { preview: vi.fn(), send: vi.fn() } }));

async function gathered(p: TriagePreview = preview) {
  vi.mocked(triageApi.preview).mockResolvedValueOnce(p);
  render(<TriageTab cluster="kind-dev" namespace="shop" pod="api-7d9-x" />);
  fireEvent.click(screen.getByRole("button", { name: "Gather evidence" }));
  await screen.findByText(p.endpoint);
}

describe("TriageTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triageApi.preview).mockResolvedValue(preview);
    vi.mocked(triageApi.send).mockResolvedValue(result);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("reads nothing until asked", () => {
    render(<TriageTab cluster="kind-dev" namespace="shop" pod="api-7d9-x" />);
    expect(screen.getByRole("button", { name: "Gather evidence" })).toBeInTheDocument();
    expect(triageApi.preview).not.toHaveBeenCalled();
  });

  it("shows exactly what would be sent, section by section", async () => {
    await gathered();
    expect(triageApi.preview).toHaveBeenCalledWith({ cluster: "kind-dev", namespace: "shop", pod: "api-7d9-x" });
    expect(screen.getByText("claude-opus-5-5")).toBeInTheDocument();
    expect(screen.getByText(/about 812 tokens/)).toBeInTheDocument();
    expect(screen.getByText(/3 values masked/)).toBeInTheDocument();
    expect(screen.getByText(/logs were cut to fit/i)).toBeInTheDocument();
    expect(screen.getByText("Logs of api (previous run, exited 2: Error)")).toBeInTheDocument();
    expect(screen.getByText(/panic: nil map\s+\(×3\)/)).toBeInTheDocument();
    expect(screen.getByText(/Use only the evidence in the bundle/)).toBeInTheDocument();
    expect(screen.getByText(/nothing has been sent/i)).toBeInTheDocument();
    expect(triageApi.send).not.toHaveBeenCalled();
  });

  it("copies the evidence for the assistant you use", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await gathered();
    fireEvent.click(screen.getByRole("button", { name: "Copy evidence" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(preview.request.messages[0]!.content[0]!.text));
  });

  it("offers Send only when there is a key", async () => {
    await gathered({ ...preview, keySource: "" });
    expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
    expect(screen.getByText(/add an API key in Settings/i)).toBeInTheDocument();
  });

  it("sends the reviewed request and shows each finding with the evidence it cites", async () => {
    await gathered();
    fireEvent.click(screen.getByRole("button", { name: "Send to claude-opus-5-5" }));
    await waitFor(() => expect(triageApi.send).toHaveBeenCalledWith("p-1"));
    expect(await screen.findByText(result.summary)).toBeInTheDocument();
    const finding = screen.getByRole("region", { name: "nil map panic at startup" });
    expect(within(finding).getByText("likely")).toBeInTheDocument();
    expect(within(finding).getByText(/previous run panicked/)).toBeInTheDocument();
    expect(within(finding).getByText("Logs of api (previous run, exited 2: Error)")).toBeInTheDocument();
    expect(within(finding).getByText("Check the config the new image reads")).toBeInTheDocument();
    expect(screen.getByText(/1 finding that cited no evidence/i)).toBeInTheDocument();
    expect(screen.getByText(/the config file the app loads/)).toBeInTheDocument();
    expect(screen.getByText(/900 tokens in, 120 out/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
  });

  it("reports a refusal instead of findings", async () => {
    vi.mocked(triageApi.send).mockResolvedValueOnce({ ...result, findings: [], dropped: 0, refusal: { category: "cyber", explanation: "declined" } });
    await gathered();
    fireEvent.click(screen.getByRole("button", { name: "Send to claude-opus-5-5" }));
    expect(await screen.findByText(/model declined to answer/i)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "nil map panic at startup" })).not.toBeInTheDocument();
  });

  it("shows a failed send and lets you try again", async () => {
    vi.mocked(triageApi.send).mockRejectedValueOnce(new Error("the model API answered 401: invalid x-api-key"));
    await gathered();
    fireEvent.click(screen.getByRole("button", { name: "Send to claude-opus-5-5" }));
    expect(await screen.findByText(/401: invalid x-api-key/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to claude-opus-5-5" })).toBeEnabled();
  });

  it("shows why evidence couldn't be gathered", async () => {
    vi.mocked(triageApi.preview).mockRejectedValueOnce(new Error('incident triage isn\'t allowed for cluster "prod": add it in Settings'));
    render(<TriageTab cluster="prod" namespace="shop" pod="api-7d9-x" />);
    fireEvent.click(screen.getByRole("button", { name: "Gather evidence" }));
    expect(await screen.findByText(/add it in Settings/)).toBeInTheDocument();
  });
});
