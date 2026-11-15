import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

vi.mock("../clusterConnections", () => ({ connectCluster: vi.fn() }));
vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, historyApi: { ...actual.historyApi, enroll: vi.fn(async () => {}) } };
});

import { connectCluster } from "../clusterConnections";
import { openCluster } from "../openCluster";
import { useClusterStore } from "../cluster-store";
import { useClusterMeta } from "../cluster-meta-store";

describe("openCluster", () => {
  beforeEach(() => {
    vi.mocked(connectCluster).mockClear();
    useClusterStore.setState({ active: "prod" });
    useClusterMeta.setState({ meta: {} });
  });

  it("connects it, makes it the active cluster, remembers it was used, refreshes its queries, and goes to its overview", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const navigate = vi.fn();
    openCluster("stage", qc, navigate);
    expect(connectCluster).toHaveBeenCalledWith("stage");
    expect(useClusterStore.getState().active).toBe("stage");
    expect(useClusterMeta.getState().meta["stage"]?.lastUsed).toBeGreaterThan(0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["stage"] });
    expect(navigate).toHaveBeenCalledWith({ pathname: "/", search: "cluster=stage" });
  });

  it("escapes an id that needs it", () => {
    const navigate = vi.fn();
    openCluster("a b/c", new QueryClient(), navigate);
    expect(navigate).toHaveBeenCalledWith({ pathname: "/", search: "cluster=a%20b%2Fc" });
  });
});
