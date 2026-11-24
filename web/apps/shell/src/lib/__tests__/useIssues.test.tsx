import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

type S = { rows: Record<string, unknown>[]; synced: boolean; connected: boolean; forbidden?: string };
let table = new Map<string, S>();
const calls: { cluster: string | undefined; gvr: string; enabled: boolean }[] = [];

vi.mock("../useResourceStream", () => ({
  useResourceStream: (cluster: string | undefined, gvr: string, opts: { enabled?: boolean } = {}) => {
    calls.push({ cluster, gvr, enabled: opts.enabled !== false });
    return table.get(gvr) ?? { rows: [], synced: true, connected: true };
  },
}));

vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  api: { clusters: vi.fn(async () => [{ id: "c1", version: "v1.30.1" }, { id: "c2", version: "v1.30.1" }]) },
  discoveryApi: { apis: vi.fn(async () => [{ group: "apps" }]), apiVersions: vi.fn(async () => ["apps/v1"]) },
}));

import { useIssues } from "../useIssues";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);
const notReadyNode = { metadata: { name: "n1" }, status: { conditions: [{ type: "Ready", status: "False" }] } };

beforeEach(() => {
  table = new Map();
  calls.length = 0;
});

describe("useIssues", () => {
  it("is loading, with nothing found, until the streams sync", () => {
    table.set("v1/pods", { rows: [], synced: false, connected: true });
    table.set("v1/nodes", { rows: [], synced: false, connected: true });
    const { result } = renderHook(() => useIssues("c1"), { wrapper });
    expect(result.current.loading).toBe(true);
    expect(result.current.issues).toEqual([]);
    expect(result.current.notChecked.some((n) => n.detector === "node-condition" && n.reason === "loading")).toBe(true);
  });

  it("returns ranked issues from the streams once synced", async () => {
    table.set("v1/nodes", { rows: [notReadyNode], synced: true, connected: true });
    const { result } = renderHook(() => useIssues("c1"), { wrapper });
    await waitFor(() => expect(result.current.issues.map((i) => i.id)).toContain("node-condition|Node||n1|NodeNotReady"));
    expect(result.current.issues[0]!.cluster).toBe("c1");
    expect(result.current.counts.critical).toBe(1);
  });

  it("marks a forbidden stream's detectors not checked, never clean", async () => {
    table.set("v1/nodes", { rows: [], synced: false, connected: true, forbidden: "forbidden: nodes" });
    const { result } = renderHook(() => useIssues("c1"), { wrapper });
    await waitFor(() => expect(result.current.notChecked.find((n) => n.detector === "node-condition")?.reason).toBe("forbidden"));
  });

  it("reports certificates not served when cert-manager is absent", async () => {
    const { result } = renderHook(() => useIssues("c1"), { wrapper });
    await waitFor(() => expect(result.current.notChecked.find((n) => n.detector === "cert-expiry")?.reason).toBe("not-served"));
  });

  it("drops the previous cluster's issues in the same render as a switch", async () => {
    table.set("v1/nodes", { rows: [notReadyNode], synced: true, connected: true });
    const renders: { c: string; n: number; loading: boolean }[] = [];
    const { result, rerender } = renderHook(
      ({ c }) => {
        const r = useIssues(c);
        renders.push({ c, n: r.issues.length, loading: r.loading });
        return r;
      },
      { wrapper, initialProps: { c: "c1" } },
    );
    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    renders.length = 0;
    // The streams still hold c1's rows in the first render for c2: it must show none of them.
    rerender({ c: "c2" });
    expect(renders[0]).toEqual({ c: "c2", n: 0, loading: true });
    await waitFor(() => expect(result.current.issues).toHaveLength(1));
    expect(result.current.issues[0]!.cluster).toBe("c2");
  });

  it("opens only the known streams, in full mode shared with the pages, and never secrets", () => {
    renderHook(() => useIssues("c1"), { wrapper });
    const gvrs = new Set(calls.map((c) => c.gvr));
    expect([...gvrs].sort()).toEqual(
      [
        "apps/v1/daemonsets", "apps/v1/deployments", "apps/v1/statefulsets", "autoscaling/v2/horizontalpodautoscalers",
        "batch/v1/cronjobs", "cert-manager.io/v1/certificates", "discovery.k8s.io/v1/endpointslices", "networking.k8s.io/v1/ingressclasses",
        "networking.k8s.io/v1/networkpolicies", "policy/v1/poddisruptionbudgets", "v1/namespaces", "v1/nodes",
        "v1/persistentvolumeclaims", "v1/pods", "v1/services", "velero.io/v1/schedules",
      ].sort(),
    );
    expect([...gvrs].some((g) => g.includes("secrets"))).toBe(false);
  });

  it("opens nothing for no cluster", () => {
    renderHook(() => useIssues(undefined), { wrapper });
    expect(calls.every((c) => c.cluster === undefined)).toBe(true);
  });
});
