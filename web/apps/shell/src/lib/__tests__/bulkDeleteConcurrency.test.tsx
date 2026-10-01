import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useBulkDelete } from "../useBulkDelete";

// Deleting 340 selected rows sent 340 DELETEs at once. They now go at most
// eight at a time, and the outcome is reported exactly as before.

describe("bulk delete concurrency", () => {
  it("runs at most eight deletes at once and reports every outcome", async () => {
    let inFlight = 0;
    let peak = 0;
    const deleteOne = async (t: { name: string }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      if (t.name === "bad-3") throw new Error("forbidden");
    };
    const { result } = renderHook(() => useBulkDelete(deleteOne));
    const targets = Array.from({ length: 30 }, (_, i) => ({ ns: "shop", name: i === 3 ? "bad-3" : `pod-${i}` }));
    act(() => result.current.request(targets));
    let succeeded: unknown[] = [];
    await act(async () => {
      succeeded = await result.current.confirm();
    });
    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
    expect(succeeded).toHaveLength(29);
    expect(result.current.error).toMatch(/29 of 30 deleted, 1 failed: bad-3: forbidden/);
  });
});
