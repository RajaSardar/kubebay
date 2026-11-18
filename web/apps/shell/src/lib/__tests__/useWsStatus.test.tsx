import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

type StatusFn = (connected: boolean, retry?: number, next?: number) => void;
let emit: StatusFn = () => {};
vi.mock("../ws", () => ({
  attach: (h: { onStatus: StatusFn }) => {
    emit = h.onStatus;
    return () => {};
  },
}));

import { useWsStatus } from "../useWsStatus";

describe("useWsStatus", () => {
  it("does not re-render on a status event that changes nothing", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useWsStatus();
    });
    act(() => emit(true, 0, 0));
    expect(result.current.connected).toBe(true);
    const settled = renders;
    // The socket re-announces itself (stable timer, re-attach): same status.
    act(() => emit(true, 0, 0));
    act(() => emit(true, 0, 0));
    expect(renders).toBe(settled);
    act(() => emit(false, 1, 1500));
    expect(result.current).toMatchObject({ connected: false, retryAttempt: 1, nextRetryMs: 1500, hasEverConnected: true });
  });
});
