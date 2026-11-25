import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { Handlers, Op } from "../ws";

const handlers: Handlers[] = [];
const subs: string[] = [];
const unsubs: string[] = [];
vi.mock("../ws", () => ({
  attach: (h: Handlers) => {
    handlers.push(h);
    return () => {};
  },
  subscribe: (s: { id: string }) => {
    subs.push(s.id);
  },
  unsubscribe: (id: string) => {
    unsubs.push(id);
  },
}));

import { useResourceStream } from "../useResourceStream";
import { clearAllStreamCache } from "../streamCache";
import { refreshAll, _resetRefreshForTests } from "../refreshAll";

const put = (i: number): Op => ({ op: "u", key: `ns/p${i}`, obj: { metadata: { name: `p${i}`, namespace: "ns" } } });

describe("useResourceStream on Refresh (⌘R)", () => {
  afterEach(() => {
    vi.useRealTimers();
    clearAllStreamCache();
    _resetRefreshForTests();
    handlers.length = 0;
    subs.length = 0;
    unsubs.length = 0;
  });

  it("re-subscribes and keeps showing the old rows until the new list has synced", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useResourceStream("c1", "v1/pods"));
    const first = subs[subs.length - 1]!;
    const h1 = handlers[handlers.length - 1]!;
    act(() => {
      h1.onBegin?.(first);
      h1.onItems?.(first, [put(1), put(2)]);
      h1.onSync?.(first);
      vi.advanceTimersByTime(20);
    });
    expect(result.current.rows).toHaveLength(2);

    act(() => {
      refreshAll(new QueryClient());
      vi.advanceTimersByTime(20);
    });
    expect(unsubs).toContain(first);
    const second = subs[subs.length - 1]!;
    expect(second).not.toBe(first);
    // No skeleton flash: the last rows stay up while the fresh list arrives.
    expect(result.current.rows).toHaveLength(2);

    const h2 = handlers[handlers.length - 1]!;
    act(() => {
      h2.onBegin?.(second);
      h2.onItems?.(second, [put(3)]);
      vi.advanceTimersByTime(20);
    });
    expect(result.current.rows).toHaveLength(2);
    act(() => {
      h2.onSync?.(second);
      vi.advanceTimersByTime(20);
    });
    expect(result.current.rows.map((r) => (r.metadata as { name: string }).name)).toEqual(["p3"]);
  });
});
