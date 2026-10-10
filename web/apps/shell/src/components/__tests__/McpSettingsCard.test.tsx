import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { McpSettingsCard } from "../McpSettingsCard";
import { api, mcpApi, type McpStatus } from "../../lib/api";

const BRIDGE = ["/Applications/Kubebay.app/Contents/MacOS/kubebay-engine", "mcp-stdio"];

let status: McpStatus;

vi.mock("../../lib/api", () => ({
  mcpApi: {
    get: vi.fn(async () => status),
    save: vi.fn(async (b: { enabled: boolean; clusters: Record<string, string[]> }) => {
      status = { ...status, ...b };
      return status;
    }),
    rotate: vi.fn(async () => status),
  },
  api: {
    clusters: vi.fn(async () => [
      { id: "kind-dev", context: "kind-dev", server: "https://127.0.0.1:6443", status: "reachable" },
      { id: "prod", context: "prod", server: "https://prod.example", status: "reachable" },
    ]),
    auditLog: vi.fn(async () => [
      { time: "2026-10-10T08:00:00Z", action: "scale", cluster: "kind-dev", resource: "web" },
      { time: "2026-10-10T08:00:05Z", action: "mcp:describe_resource", cluster: "kind-dev", namespace: "shop", detail: "pods/api-7d9-x request=3", userAgent: "claude-code 2.1", source: "mcp" },
    ]),
  },
}));

function renderCard() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <McpSettingsCard />
    </QueryClientProvider>,
  );
}

const off = (): McpStatus => ({ enabled: false, clusters: {}, url: "http://127.0.0.1:9898/mcp", bridgeCommand: BRIDGE });
const on = (): McpStatus => ({ ...off(), enabled: true, clusters: { "kind-dev": [] }, connectionFile: "/Users/me/.kubebay/mcp.json" });

describe("McpSettingsCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    status = off();
  });

  it("is off by default and says what turning it on allows", async () => {
    renderCard();
    expect(await screen.findByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/secrets are never shown/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  });

  it("turns on for the clusters you pick, whole cluster or named namespaces", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Allow kind-dev" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow prod" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Namespaces for prod" }), { target: { value: "shop, ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(mcpApi.save).toHaveBeenCalledWith({ enabled: true, clusters: { "kind-dev": [], prod: ["shop", "ops"] } }));
  });

  it("shows how to connect Claude Desktop and Claude Code, without the token", async () => {
    status = on();
    renderCard();
    const desktop = await screen.findByLabelText("Claude Desktop configuration");
    expect(JSON.parse(desktop.textContent ?? "")).toEqual({ mcpServers: { kubebay: { command: BRIDGE[0], args: ["mcp-stdio"] } } });
    expect(screen.getByLabelText("Claude Code command").textContent).toBe(`claude mcp add --scope user kubebay -- ${BRIDGE[0]} mcp-stdio`);
    expect(screen.getByText("/Users/me/.kubebay/mcp.json")).toBeInTheDocument();
  });

  it("turning off keeps the scope for next time and revokes access", async () => {
    status = on();
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(mcpApi.save).toHaveBeenCalledWith({ enabled: false, clusters: { "kind-dev": [] } }));
  });

  it("turns off with the saved scope, so an unsaved bad edit can't block the kill switch", async () => {
    status = on();
    renderCard();
    fireEvent.change(await screen.findByRole("textbox", { name: "Namespaces for kind-dev" }), { target: { value: "Bad_NS" } });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(mcpApi.save).toHaveBeenCalledWith({ enabled: false, clusters: { "kind-dev": [] } }));
  });

  it("saves a changed scope while on", async () => {
    status = on();
    renderCard();
    fireEvent.change(await screen.findByRole("textbox", { name: "Namespaces for kind-dev" }), { target: { value: "shop" } });
    fireEvent.click(screen.getByRole("button", { name: "Save scope" }));
    await waitFor(() => expect(mcpApi.save).toHaveBeenCalledWith({ enabled: true, clusters: { "kind-dev": ["shop"] } }));
  });

  it("rotates the token only after confirming", async () => {
    status = on();
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Rotate token" }));
    expect(mcpApi.rotate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /disconnect direct clients/i }));
    await waitFor(() => expect(mcpApi.rotate).toHaveBeenCalled());
  });

  it("lists recent assistant calls from the audit log, and nothing else", async () => {
    status = on();
    renderCard();
    expect(await screen.findByText("describe_resource")).toBeInTheDocument();
    expect(screen.getByText("claude-code 2.1")).toBeInTheDocument();
    expect(screen.queryByText("scale")).not.toBeInTheDocument();
  });

  it("explains why it can't be turned on in this engine", async () => {
    status = { ...off(), disabled: "the MCP server is off in in-cluster mode" };
    renderCard();
    expect(await screen.findByText(/off in in-cluster mode/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });

  it("shows the engine's refusal when a save fails", async () => {
    vi.mocked(mcpApi.save).mockRejectedValueOnce(new Error('namespace "Shop": a lowercase RFC 1123 label must consist of…'));
    renderCard();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Allow kind-dev" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText(/namespace "Shop"/)).toBeInTheDocument();
  });

  it("keeps a scoped cluster that left the kubeconfig, so it can be removed", async () => {
    status = { ...on(), clusters: { "kind-dev": [], "old-eks": ["shop"] } };
    renderCard();
    expect(await screen.findByRole("checkbox", { name: "Allow old-eks" })).toBeChecked();
    expect(vi.mocked(api.clusters)).toHaveBeenCalled();
  });
});
