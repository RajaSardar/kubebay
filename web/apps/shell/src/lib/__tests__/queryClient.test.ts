import { describe, expect, it } from "vitest";
import { createQueryClient } from "../queryClient";

// Backlog 23 pass 2: no query polls unless it asks to. A global interval made
// every mounted query (CRD lists, RBAC, settings...) refetch every 30 s.
describe("createQueryClient", () => {
  it("sets no global refetchInterval", () => {
    expect(createQueryClient().getDefaultOptions().queries?.refetchInterval).toBeUndefined();
  });

  it("keeps the cache defaults the cluster switch relies on", () => {
    const q = createQueryClient().getDefaultOptions().queries!;
    expect(q.staleTime).toBe(30_000);
    expect(q.gcTime).toBe(10 * 60_000);
    expect(q.retry).toBe(1);
  });
});
