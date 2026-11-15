import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useTriageAllowed } from "../useTriageAllowed";
import { triageApi, type TriageStatus } from "../api";

vi.mock("../api", () => ({ triageApi: { get: vi.fn() } }));

const st = (over: Partial<TriageStatus>): TriageStatus => ({
  enabled: true,
  clusters: ["kind-dev"],
  baseURL: "",
  model: "",
  key: { source: "", store: "" },
  ...over,
});

describe("useTriageAllowed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is true only when triage is on and the cluster is allowed", async () => {
    vi.mocked(triageApi.get).mockResolvedValue(st({}));
    const yes = renderHook(() => useTriageAllowed("kind-dev"));
    await waitFor(() => expect(yes.result.current).toBe(true));
    const other = renderHook(() => useTriageAllowed("prod"));
    await waitFor(() => expect(triageApi.get).toHaveBeenCalledTimes(2));
    expect(other.result.current).toBe(false);
  });

  it("is false while off, unavailable, or unreachable", async () => {
    for (const s of [st({ enabled: false }), st({ disabled: "in-cluster" })]) {
      vi.mocked(triageApi.get).mockResolvedValueOnce(s);
      const { result } = renderHook(() => useTriageAllowed("kind-dev"));
      await waitFor(() => expect(triageApi.get).toHaveBeenCalled());
      expect(result.current).toBe(false);
    }
    vi.mocked(triageApi.get).mockRejectedValueOnce(new Error("404"));
    const { result } = renderHook(() => useTriageAllowed("kind-dev"));
    await waitFor(() => expect(triageApi.get).toHaveBeenCalledTimes(3));
    expect(result.current).toBe(false);
  });
});
