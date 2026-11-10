import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLeadingThrottle } from "../useLeadingThrottle";

describe("useLeadingThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns the initial value immediately (leading edge)", () => {
    const { result } = renderHook(() => useLeadingThrottle("a", 2000));
    expect(result.current).toBe("a");
  });

  it("updates immediately when at least the interval has elapsed since the last update", () => {
    const { result, rerender } = renderHook(({ v }) => useLeadingThrottle(v, 2000), { initialProps: { v: "a" } });
    act(() => vi.advanceTimersByTime(2500));
    rerender({ v: "b" });
    expect(result.current).toBe("b");
  });

  it("holds the old value and schedules an update when called again inside the window", () => {
    const { result, rerender } = renderHook(({ v }) => useLeadingThrottle(v, 2000), { initialProps: { v: "a" } });
    rerender({ v: "b" }); // immediately inside the window (0ms elapsed) — leading edge already spent on "a"
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe("b");
  });

  it("coalesces multiple rapid updates into the latest value once the window elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useLeadingThrottle(v, 2000), { initialProps: { v: "a" } });
    rerender({ v: "b" });
    rerender({ v: "c" });
    rerender({ v: "d" });
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe("d");
  });

  it("applies a value at once when flush says the change matters, then throttles again", () => {
    type V = { ready: boolean; n: number };
    const changedReady = (prev: V, next: V) => prev.ready !== next.ready;
    const { result, rerender } = renderHook(({ v }) => useLeadingThrottle(v, 2000, changedReady), {
      initialProps: { v: { ready: false, n: 0 } as V },
    });
    rerender({ v: { ready: true, n: 5 } }); // inside the window, but readiness changed
    expect(result.current).toEqual({ ready: true, n: 5 });
    rerender({ v: { ready: true, n: 6 } }); // an ordinary update inside the window is held
    expect(result.current).toEqual({ ready: true, n: 5 });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toEqual({ ready: true, n: 6 });
  });
});
