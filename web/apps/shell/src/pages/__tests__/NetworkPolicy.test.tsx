import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import NetworkPolicyPage from "../NetworkPolicy";
import { useResourceStream } from "../../lib/useResourceStream";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../components/NamespaceFilter", () => ({ NamespaceFilter: () => null }));

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({
    rows:
      gvr === "v1/pods"
        ? [{ metadata: { name: "web-1", namespace: "shop", labels: { app: "web" } }, spec: { containers: [] }, status: {} }]
        : [],
    synced: true,
  })),
  shouldShowSkeleton: () => false,
}));

function enabledFor(gvr: string): boolean | undefined {
  const call = vi.mocked(useResourceStream).mock.calls.filter(([, g]) => g === gvr).at(-1);
  return call ? ((call[2] as { enabled?: boolean } | undefined)?.enabled ?? true) : undefined;
}

describe("NetworkPolicyPage", () => {
  it("offers a reachability check that streams namespaces only while it's open", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <NetworkPolicyPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(enabledFor("v1/namespaces")).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Can A reach B?" }));
    expect(enabledFor("v1/namespaces")).toBe(true);
    expect(screen.getByLabelText("Source pod")).toBeInTheDocument();
  });
});
