import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { McpProposals } from "../McpProposals";
import { mcpApi, type McpProposal, type McpStatus } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  mcpApi: { get: vi.fn(), proposals: vi.fn(), approve: vi.fn(), reject: vi.fn() },
}));

const proposal = (over: Partial<McpProposal> = {}): McpProposal => ({
  id: "p-1a2b",
  cluster: "kind-dev",
  kind: "deployments",
  namespace: "shop",
  name: "api",
  reason: "api is CPU-bound at 2 replicas",
  client: "claude-code 2.1",
  resourceVersion: "7",
  diff: " spec:\n-  replicas: 2\n+  replicas: 4\n",
  changedPaths: ["spec.replicas"],
  status: "pending",
  created: new Date().toISOString(),
  expires: new Date(Date.now() + 4 * 60_000).toISOString(),
  ...over,
});

const status = (over: Partial<McpStatus> = {}): McpStatus => ({ enabled: true, writesEnabled: true, clusters: { "kind-dev": [] }, url: "", ...over });

function renderIt() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <McpProposals />
    </QueryClientProvider>,
  );
}

describe("McpProposals (backlog #5 phase 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mcpApi.get).mockResolvedValue(status());
    vi.mocked(mcpApi.proposals).mockResolvedValue({ pending: [proposal()], recent: [], writesEnabled: true });
    vi.mocked(mcpApi.approve).mockResolvedValue(proposal({ status: "applied" }));
    vi.mocked(mcpApi.reject).mockResolvedValue(proposal({ status: "rejected" }));
  });

  it("asks nothing while proposals are off", async () => {
    vi.mocked(mcpApi.get).mockResolvedValue(status({ writesEnabled: false }));
    const { container } = renderIt();
    await waitFor(() => expect(mcpApi.get).toHaveBeenCalled());
    expect(mcpApi.proposals).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows who proposes what, why, and the exact diff", async () => {
    renderIt();
    const dialog = await screen.findByRole("dialog", { name: /claude-code 2.1 proposes a change/i });
    expect(dialog).toHaveTextContent("claude-code 2.1");
    expect(dialog).toHaveTextContent("deployments shop/api");
    expect(dialog).toHaveTextContent("kind-dev");
    expect(dialog).toHaveTextContent("api is CPU-bound at 2 replicas");
    expect(dialog).toHaveTextContent("spec.replicas");
    expect(screen.getByText(/^\+\s+replicas: 4$/)).toBeInTheDocument();
    expect(screen.getByText(/^-\s+replicas: 2$/)).toBeInTheDocument();
  });

  it("applies only when you approve", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Approve and apply" }));
    await waitFor(() => expect(mcpApi.approve).toHaveBeenCalledWith("p-1a2b"));
    expect(mcpApi.reject).not.toHaveBeenCalled();
  });

  it("rejects", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));
    await waitFor(() => expect(mcpApi.reject).toHaveBeenCalledWith("p-1a2b"));
    expect(mcpApi.approve).not.toHaveBeenCalled();
  });

  it("shows why an approval didn't apply", async () => {
    vi.mocked(mcpApi.approve).mockRejectedValueOnce(new Error("the object changed after this proposal was made, so it wasn't applied"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Approve and apply" }));
    expect(await screen.findByText(/changed after this proposal was made/)).toBeInTheDocument();
  });

  it("can wait: Decide later closes it until something new arrives", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Decide later" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(mcpApi.approve).not.toHaveBeenCalled();
    expect(mcpApi.reject).not.toHaveBeenCalled();
  });
});
