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

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <NetworkPolicyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("NetworkPolicyPage", () => {
  it("streams namespace labels only on the tabs that evaluate policy", () => {
    renderPage();
    expect(enabledFor("v1/namespaces")).toBe(true); // matrix is the default tab
    fireEvent.click(screen.getByRole("radio", { name: "Policy list" }));
    expect(enabledFor("v1/namespaces")).toBe(false);
    fireEvent.click(screen.getByRole("radio", { name: "Can A reach B?" }));
    expect(enabledFor("v1/namespaces")).toBe(true);
    expect(screen.getByLabelText("Source pod")).toBeInTheDocument();
  });

  it("offers a live network check next to the static reachability answer", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Can A reach B?" }));
    expect(screen.getByText("Live network check")).toBeInTheDocument();
  });

  it("has a Build policy tab with the editor, streaming namespace labels for its impact preview", () => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: "Build policy" }));
    expect(screen.getByText("Build a NetworkPolicy")).toBeInTheDocument();
    expect(enabledFor("v1/namespaces")).toBe(true);
  });

  it("marks a cell blocked when the source's egress policy denies it, per pod rather than per namespace", () => {
    const rows: Record<string, unknown[]> = {
      "v1/pods": [
        { metadata: { name: "web-1", namespace: "shop", labels: { app: "web" } }, spec: { containers: [] }, status: {} },
        { metadata: { name: "api-1", namespace: "shop", labels: { app: "api" } }, spec: { containers: [] }, status: {} },
      ],
      "networking.k8s.io/v1/networkpolicies": [
        { metadata: { name: "no-egress", namespace: "shop" }, spec: { podSelector: { matchLabels: { app: "web" } }, policyTypes: ["Egress"] } },
      ],
    };
    vi.mocked(useResourceStream).mockImplementation(((_c: string, gvr: string) => ({ rows: rows[gvr] ?? [], synced: true })) as never);
    renderPage();
    expect(screen.getByTitle("web → api: blocked")).toBeInTheDocument();
    expect(screen.getByTitle("api → web: open")).toBeInTheDocument();
  });
});
