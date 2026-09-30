import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import WorkloadsOverview from "../WorkloadsOverview";
import { useResourceStream } from "../../lib/useResourceStream";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn(() => ({ rows: [], synced: true })),
  shouldShowSkeleton: () => false,
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WorkloadsOverview />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Every `enabled` value passed for a GVR on the most recent render. */
function enabledFor(gvr: string): boolean[] {
  const calls = vi.mocked(useResourceStream).mock.calls;
  const perRender = calls.filter(([, g]) => g === gvr);
  // useResourceStream is called once per GVR per render; the last N calls are the latest render.
  const count = new Set(calls.map(([, g]) => g)).size;
  const latest = calls.slice(-count).filter(([, g]) => g === gvr);
  return (latest.length ? latest : perRender).map(([, , opts]) => (opts as { enabled?: boolean } | undefined)?.enabled ?? true);
}

describe("WorkloadsOverview", () => {
  beforeEach(() => vi.mocked(useResourceStream).mockClear());

  it("opens exactly one services and one endpointslices subscription per render", () => {
    renderPage();
    const calls = vi.mocked(useResourceStream).mock.calls;
    const perRender = new Set(calls.map(([, g]) => g)).size;
    const latest = calls.slice(-perRender);
    expect(latest.filter(([, g]) => g === "v1/services")).toHaveLength(1);
    expect(latest.filter(([, g]) => g === "discovery.k8s.io/v1/endpointslices")).toHaveLength(1);
  });

  it("keeps the services/endpointslices streams off on the Overview tab", () => {
    renderPage();
    expect(enabledFor("v1/services")).toEqual([false]);
    expect(enabledFor("discovery.k8s.io/v1/endpointslices")).toEqual([false]);
  });

  it.each([["SPOF Radar"], ["Service Health"]])("enables the shared streams on the %s tab", (label) => {
    renderPage();
    fireEvent.click(screen.getByRole("radio", { name: label }));
    expect(enabledFor("v1/services")).toEqual([true]);
    expect(enabledFor("discovery.k8s.io/v1/endpointslices")).toEqual([true]);
  });
});
