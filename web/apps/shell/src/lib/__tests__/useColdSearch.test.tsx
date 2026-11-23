import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, searchApi: { ...actual.searchApi, clusters: vi.fn() } };
});

import { searchApi, type ColdSearchResponse } from "../api";
import { useColdSearch } from "../useColdSearch";

const reply = (over: Partial<ColdSearchResponse> = {}): ColdSearchResponse => ({ hits: [], total: 0, capped: false, kinds: [], clusters: [], ...over });
const settle = (ms = 400) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(searchApi.clusters).mockReset().mockResolvedValue(reply());
});
afterEach(() => vi.useRealTimers());

describe("useColdSearch", () => {
  it("asks nothing until the user opts in, or with no clusters or no words", async () => {
    renderHook(() => useColdSearch(false, ["stage"], "api"));
    renderHook(() => useColdSearch(true, [], "api"));
    renderHook(() => useColdSearch(true, ["stage"], "  "));
    await settle();
    expect(searchApi.clusters).not.toHaveBeenCalled();
  });

  it("asks once typing pauses, for the disconnected clusters only", async () => {
    const { rerender } = renderHook(({ q }) => useColdSearch(true, ["stage", "dev"], q), { initialProps: { q: "a" } });
    rerender({ q: "ap" });
    rerender({ q: "api" });
    await settle();
    expect(searchApi.clusters).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchApi.clusters).mock.calls[0]!.slice(0, 2)).toEqual([["stage", "dev"], "api"]);
  });

  it("asks again while a cluster is still being searched, and stops once all have answered", async () => {
    vi.mocked(searchApi.clusters)
      .mockResolvedValueOnce(reply({ clusters: [{ id: "stage", pending: true, denied: [], truncated: [], hits: 0 }] }))
      .mockResolvedValue(reply({ total: 1, hits: [{ cluster: "stage", slug: "pods", kind: "Pods", ns: "a", name: "api", score: 100 }], clusters: [{ id: "stage", denied: [], truncated: [], hits: 1 }] }));
    const { result } = renderHook(() => useColdSearch(true, ["stage"], "api"));
    await settle();
    expect(result.current.loading).toBe(true);
    await settle(2000);
    expect(searchApi.clusters).toHaveBeenCalledTimes(2);
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.hits[0]?.name).toBe("api");
    await settle(5000);
    expect(searchApi.clusters).toHaveBeenCalledTimes(2);
  });

  it("reports a failed request as an error", async () => {
    vi.mocked(searchApi.clusters).mockRejectedValue(new Error("502 bad gateway"));
    const { result } = renderHook(() => useColdSearch(true, ["stage"], "api"));
    await settle();
    expect(result.current.error).toBe("502 bad gateway");
  });
});
