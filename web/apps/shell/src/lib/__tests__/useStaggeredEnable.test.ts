import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStaggeredEnable } from "../useStaggeredEnable";

describe("useStaggeredEnable", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is enabled immediately for the first wave (index within concurrency)", () => {
    const { result } = renderHook(() => useStaggeredEnable(0, 3, 500));
    expect(result.current).toBe(true);
  });

  it("is not enabled immediately for a later wave, then flips true once its delay elapses", () => {
    const { result } = renderHook(() => useStaggeredEnable(3, 3, 500));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    expect(result.current).toBe(true);
  });

  it("does not flip early, before its wave's delay has elapsed", () => {
    const { result } = renderHook(() => useStaggeredEnable(6, 3, 500));
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });
});
