import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TriageSettingsCard } from "../TriageSettingsCard";
import { triageApi, type TriageStatus } from "../../lib/api";

let status: TriageStatus;

vi.mock("../../lib/api", () => ({
  triageApi: {
    get: vi.fn(async () => status),
    save: vi.fn(async (b: Partial<TriageStatus>) => {
      status = { ...status, ...b };
      return status;
    }),
    putKey: vi.fn(async () => {
      status = { ...status, key: { ...status.key, source: "keychain" } };
      return status;
    }),
    deleteKey: vi.fn(async () => {
      status = { ...status, key: { ...status.key, source: "" } };
      return status;
    }),
  },
  api: {
    clusters: vi.fn(async () => [
      { id: "kind-dev", context: "kind-dev", server: "https://127.0.0.1:6443", status: "reachable" },
      { id: "prod", context: "prod", server: "https://prod.example", status: "reachable" },
    ]),
  },
}));

const off = (): TriageStatus => ({
  enabled: false,
  clusters: [],
  baseURL: "https://api.anthropic.com",
  model: "claude-opus-5-5",
  key: { source: "", store: "macOS Keychain" },
});

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TriageSettingsCard />
    </QueryClientProvider>,
  );
}

describe("TriageSettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = off();
  });

  it("is off by default and says nothing leaves without review", async () => {
    renderCard();
    expect(await screen.findByText(/shows exactly what would be sent/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  });

  it("turns on only for the clusters you allow", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Allow kind-dev" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(triageApi.save).toHaveBeenCalledWith({ enabled: true, clusters: ["kind-dev"], baseURL: "https://api.anthropic.com", model: "claude-opus-5-5" }),
    );
  });

  it("points at an enterprise proxy and another model", async () => {
    status = { ...off(), enabled: true, clusters: ["kind-dev"] };
    renderCard();
    fireEvent.change(await screen.findByRole("textbox", { name: "Endpoint" }), { target: { value: "https://llm.corp.example" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Model" }), { target: { value: "claude-sonnet-5-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(triageApi.save).toHaveBeenCalledWith({ enabled: true, clusters: ["kind-dev"], baseURL: "https://llm.corp.example", model: "claude-sonnet-5-5" }),
    );
  });

  it("turns off with the saved settings", async () => {
    status = { ...off(), enabled: true, clusters: ["kind-dev"] };
    renderCard();
    fireEvent.change(await screen.findByRole("textbox", { name: "Endpoint" }), { target: { value: "http://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() =>
      expect(triageApi.save).toHaveBeenCalledWith({ enabled: false, clusters: ["kind-dev"], baseURL: "https://api.anthropic.com", model: "claude-opus-5-5" }),
    );
  });

  it("saves the key to the keychain and never shows it again", async () => {
    renderCard();
    const field = await screen.findByLabelText("API key");
    expect(field).toHaveAttribute("type", "password");
    fireEvent.change(field, { target: { value: "sk-ant-api03-abcdefghijklmnop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    await waitFor(() => expect(triageApi.putKey).toHaveBeenCalledWith("sk-ant-api03-abcdefghijklmnop"));
    expect(await screen.findByText(/saved in macOS Keychain/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("sk-ant-api03-abcdefghijklmnop")).not.toBeInTheDocument();
  });

  it("removes a keychain key after confirming", async () => {
    status = { ...off(), key: { source: "keychain", store: "macOS Keychain" } };
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Remove key" }));
    expect(triageApi.deleteKey).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /remove the key/i }));
    await waitFor(() => expect(triageApi.deleteKey).toHaveBeenCalled());
  });

  it("names an environment key and offers no field to replace it", async () => {
    status = { ...off(), key: { source: "env:ANTHROPIC_API_KEY", store: "macOS Keychain" } };
    renderCard();
    expect(await screen.findByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("without a keychain, says to use the environment", async () => {
    status = { ...off(), key: { source: "", store: "" } };
    renderCard();
    expect(await screen.findByText("KUBEBAY_TRIAGE_API_KEY")).toBeInTheDocument();
    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
  });

  it("shows the engine's refusal when a save fails", async () => {
    status = { ...off(), enabled: true, clusters: ["kind-dev"] };
    vi.mocked(triageApi.save).mockRejectedValueOnce(new Error('endpoint "http://example.com": use https'));
    renderCard();
    fireEvent.change(await screen.findByRole("textbox", { name: "Endpoint" }), { target: { value: "http://example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/use https/)).toBeInTheDocument();
  });

  it("explains why it isn't available in this engine", async () => {
    status = { ...off(), disabled: "incident triage is off in in-cluster mode" };
    renderCard();
    expect(await screen.findByText(/off in in-cluster mode/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });
});
