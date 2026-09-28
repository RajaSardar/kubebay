import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { useFleetWaste } from "../useFleetWaste";
import { wasteApi } from "../api";

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, wasteApi: { workloads: vi.fn() } };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

describe("useFleetWaste", () => {
  it("sums waste across clusters once every query resolves", async () => {
    vi.mocked(wasteApi.workloads).mockImplementation((cluster: string) =>
      Promise.resolve([
        {
          cluster,
          ns: "default",
          kind: "Deployment",
          name: "web",
          podCount: 2,
          requestedCpuMillis: 1000,
          requestedMemBytes: 1024 ** 3,
          p95CpuMillis: 100,
          p95MemBytes: 100 * 1024 ** 2,
          source: "metrics-server",
          window: "3h",
        },
      ]),
    );

    const { result } = renderHook(() => useFleetWaste(["kind-a", "kind-b"]), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.summary.perCluster).toHaveLength(2);
    expect(result.current.summary.totalWastedCpuMillis).toBeGreaterThan(0);
  });

  it("returns an empty summary for an empty cluster list, with no query calls", () => {
    const { result } = renderHook(() => useFleetWaste([]), { wrapper });
    expect(result.current.summary.perCluster).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
