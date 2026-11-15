import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { McpChip } from "../McpChip";
import { mcpApi } from "../../lib/api";

vi.mock("../../lib/api", () => ({ mcpApi: { get: vi.fn() } }));

function renderChip() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <McpChip />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("McpChip", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says assistants have access, and links to the switch", async () => {
    vi.mocked(mcpApi.get).mockResolvedValue({ enabled: true, clusters: { "kind-dev": [], prod: ["shop"] }, url: "" });
    renderChip();
    const link = await screen.findByRole("link", { name: /AI access on/ });
    expect(link).toHaveAttribute("href", "/settings#mcp");
    expect(link).toHaveAttribute("title", expect.stringMatching(/2 clusters/));
  });

  it("is absent while MCP is off or unavailable", async () => {
    vi.mocked(mcpApi.get).mockResolvedValue({ enabled: false, clusters: {}, url: "" });
    const { container } = renderChip();
    await vi.waitFor(() => expect(mcpApi.get).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    vi.mocked(mcpApi.get).mockRejectedValue(new Error("404"));
    const again = renderChip();
    await vi.waitFor(() => expect(mcpApi.get).toHaveBeenCalledTimes(2));
    expect(again.container).toBeEmptyDOMElement();
  });
});
