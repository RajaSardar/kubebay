import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type S = { rows: Record<string, unknown>[]; synced: boolean; connected: boolean; forbidden?: string };
let table = new Map<string, S>();
let apisFail = false;

vi.mock("../useResourceStream", () => ({
  useResourceStream: (_c: string | undefined, gvr: string) => table.get(gvr) ?? { rows: [], synced: true, connected: true },
}));
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  api: { clusters: vi.fn(async () => [{ id: "c1", version: "v1.30.1" }]) },
  discoveryApi: {
    apis: vi.fn(async () => { if (apisFail) throw new Error("boom"); return [{ group: "apps" }]; }),
    apiVersions: vi.fn(async () => ["apps/v1"]),
  },
}));

import { useIssues } from "../useIssues";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => { table = new Map(); apisFail = false; });
afterEach(() => vi.useRealTimers());

describe("useIssues honesty over time", () => {
  it("says the check failed, not still loading, when API discovery fails", async () => {
    apisFail = true;
    const { result } = renderHook(() => useIssues("c1"), { wrapper });
    await waitFor(() => expect(result.current.notChecked.find((n) => n.detector === "cert-expiry")?.reason).toBe("error"));
    expect(result.current.notChecked.find((n) => n.detector === "best-practice")?.reason).toBe("error");
    expect(result.current.loading).toBe(false);
  });

  it("flags a pod that has been Pending past the grace period without any row change", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(Date.parse("2026-10-02T12:00:00Z"));
    const pending = { metadata: { name: "p", namespace: "shop", creationTimestamp: "2026-10-02T11:58:00Z" }, spec: {}, status: { phase: "Pending" } };
    const rows = [pending];
    table.set("v1/pods", { rows, synced: true, connected: true });
    const { result } = renderHook(() => useIssues("c1"), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current.issues.filter((i) => i.detector === "pod-problem")).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(6 * 60_000); });
    expect(result.current.issues.filter((i) => i.detector === "pod-problem")).toHaveLength(1);
  });
});
