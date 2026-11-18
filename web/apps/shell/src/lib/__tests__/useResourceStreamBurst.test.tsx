import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Handlers, Op } from "../ws";

const handlers: Handlers[] = [];
let subId = "";
vi.mock("../ws", () => ({
  attach: (h: Handlers) => {
    handlers.push(h);
    return () => {};
  },
  subscribe: (s: { id: string }) => {
    subId = s.id;
  },
  unsubscribe: () => {},
}));

import { useResourceStream } from "../useResourceStream";
import { clearAllStreamCache } from "../streamCache";

const put = (i: number): Op => ({ op: "u", key: `ns/p${i}`, obj: { metadata: { name: `p${i}`, namespace: "ns" } } });

describe("useResourceStream under a burst of frames", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearAllStreamCache();
    handlers.length = 0;
  });

  it("collapses hundreds of delta frames into a handful of renders", () => {
    vi.useFakeTimers();
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useResourceStream("c1", "v1/pods");
    });
    const h = handlers[handlers.length - 1]!;
    act(() => {
      h.onBegin?.(subId);
      h.onItems?.(subId, Array.from({ length: 500 }, (_, i) => put(i)));
      h.onSync?.(subId);
      vi.advanceTimersByTime(20);
    });
    const settled = renders;
    act(() => {
      for (let i = 0; i < 300; i++) h.onDelta?.(subId, [put(1000 + i)]);
      vi.advanceTimersByTime(20);
    });
    expect(result.current.rows).toHaveLength(800);
    // One flush window for 300 frames: bounded, and nowhere near 300.
    expect(renders - settled).toBeLessThanOrEqual(3);
  });
});
