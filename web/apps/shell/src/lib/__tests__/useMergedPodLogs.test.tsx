import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Handlers } from "../ws";

// Backlog 59: one stream per pod, merged into one list, a few opening at a time.
let handlers: Handlers[] = [];
const opened: { id: string; pod: string }[] = [];
const closed: string[] = [];
vi.mock("../ws", () => ({
  attach: (h: Handlers) => {
    handlers.push(h);
    return () => {
      handlers = handlers.filter((x) => x !== h);
    };
  },
  openChannel: (c: { id: string; pod: string }) => opened.push({ id: c.id, pod: c.pod }),
  closeChannel: (id: string) => closed.push(id),
}));

const { useMergedPodLogs, mergedLinesLimit, OPEN_AT_ONCE } = await import("../useMergedPodLogs");

const enc = new TextEncoder();
const send = (pod: string, text: string) => {
  const id = opened.find((o) => o.pod === pod)!.id;
  act(() => handlers.forEach((h) => h.onChanData?.(id, enc.encode(text))));
};
const spec = (pods: string[]) => ({ cluster: "c", namespace: "ns", pods: pods.map((p) => ({ pod: p, container: "app" })), tail: 100, follow: true, previous: false });

beforeEach(() => {
  handlers = [];
  opened.length = 0;
  closed.length = 0;
  vi.stubGlobal("requestAnimationFrame", (f: () => void) => {
    f();
    return 0; // already flushed, so the hook may schedule again
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

describe("useMergedPodLogs", () => {
  it("merges every pod's lines in arrival order, each tagged with its pod", () => {
    const { result } = renderHook(() => useMergedPodLogs(spec(["a", "b"])));
    send("a", "one\ntwo\n");
    send("b", "three\n");
    send("a", "four\n");
    expect(result.current.lines.map((l) => [l.pod, l.text])).toEqual([
      ["a", "one"],
      ["a", "two"],
      ["b", "three"],
      ["a", "four"],
    ]);
  });

  it("joins a line split across two chunks", () => {
    const { result } = renderHook(() => useMergedPodLogs(spec(["a"])));
    send("a", "hel");
    send("a", "lo\n");
    expect(result.current.lines.map((l) => l.text)).toEqual(["hello"]);
  });

  it("opens only a few channels at a time, the next as each is acknowledged", () => {
    const pods = Array.from({ length: OPEN_AT_ONCE + 3 }, (_, i) => `p${i}`);
    renderHook(() => useMergedPodLogs(spec(pods)));
    expect(opened).toHaveLength(OPEN_AT_ONCE);
    act(() => handlers.forEach((h) => h.onAck?.(opened[0]!.id)));
    expect(opened).toHaveLength(OPEN_AT_ONCE + 1);
    act(() => handlers.forEach((h) => h.onChanClosed?.(opened[1]!.id, "done")));
    expect(opened).toHaveLength(OPEN_AT_ONCE + 2);
  });

  it("closes every channel on unmount", () => {
    const { unmount } = renderHook(() => useMergedPodLogs(spec(["a", "b"])));
    unmount();
    expect(closed.sort()).toEqual(opened.map((o) => o.id).sort());
  });

  it("keeps only the newest lines past the limit", () => {
    const { result } = renderHook(() => useMergedPodLogs(spec(["a"])));
    send("a", Array.from({ length: mergedLinesLimit + 5 }, (_, i) => `l${i}`).join("\n") + "\n");
    expect(result.current.lines).toHaveLength(mergedLinesLimit);
    expect(result.current.lines.at(-1)!.text).toBe(`l${mergedLinesLimit + 4}`);
  });

  it("reports a pod whose stream failed, by name, and carries on with the rest", () => {
    const { result } = renderHook(() => useMergedPodLogs(spec(["a", "b"])));
    act(() => handlers.forEach((h) => h.onChanClosed?.(opened.find((o) => o.pod === "a")!.id, "forbidden: pods/log")));
    send("b", "still here\n");
    expect(result.current.errors).toEqual({ a: "forbidden: pods/log" });
    expect(result.current.lines.map((l) => l.text)).toEqual(["still here"]);
  });
});
