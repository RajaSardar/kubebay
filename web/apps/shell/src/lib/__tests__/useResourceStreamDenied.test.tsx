import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Handlers, SubSpec } from "../ws";

// A subscription over several namespaces where RBAC refuses one: the engine
// names it in a "denied" frame and goes on with the others. The hook lists
// the refused namespaces and drops any rows it held from them, so nothing on
// screen claims to be live data it can no longer see.
const listeners = new Set<Handlers>();
const subs: SubSpec[] = [];
vi.mock("../ws", () => ({
  attach: (h: Handlers) => {
    listeners.add(h);
    return () => listeners.delete(h);
  },
  subscribe: (s: SubSpec) => subs.push(s),
  unsubscribe: () => {},
}));

const { useResourceStream } = await import("../useResourceStream");
const emit = (fn: (h: Handlers) => void) => act(() => { for (const h of [...listeners]) fn(h); });
const flush = () => act(() => new Promise((r) => setTimeout(r, 30)));
const pod = (ns: string, name: string) => ({ op: "u" as const, key: `${ns}/${name}`, obj: { metadata: { name, namespace: ns } } });

afterEach(() => {
  listeners.clear();
  subs.length = 0;
});

describe("a refused namespace", () => {
  it("is listed with its reason, and only its rows are dropped", async () => {
    const { result } = renderHook(() => useResourceStream("kind", "v1/pods", { mode: "full", ns: ["shop", "payments"] }));
    const id = subs.at(-1)!.id;
    emit((h) => h.onBegin?.(id));
    emit((h) => h.onItems?.(id, [pod("shop", "api"), pod("payments", "gateway")]));
    emit((h) => h.onSync?.(id));
    emit((h) => h.onDenied?.(id, "payments", 'pods is forbidden: User "dev" cannot list resource "pods" in the namespace "payments"'));
    await flush();

    expect(result.current.denied).toEqual([
      { ns: "payments", reason: 'pods is forbidden: User "dev" cannot list resource "pods" in the namespace "payments"' },
    ]);
    expect(result.current.rows.map((r) => (r.metadata as { name: string }).name)).toEqual(["api"]);
    expect(result.current.synced).toBe(true);
  });

  it("ignores another subscription's denials", async () => {
    const { result } = renderHook(() => useResourceStream("kind", "v1/pods", { mode: "full", ns: ["shop"] }));
    emit((h) => h.onDenied?.("ui-someone-else", "payments", "pods is forbidden"));
    await flush();
    expect(result.current.denied).toBeUndefined();
  });
});

describe("a stream refused everywhere", () => {
  it("is no longer synced, so nothing calls its rows live", async () => {
    const { result } = renderHook(() => useResourceStream("kind", "v1/pods", { mode: "full" }));
    const id = subs.at(-1)!.id;
    emit((h) => h.onBegin?.(id));
    emit((h) => h.onItems?.(id, [pod("shop", "api")]));
    emit((h) => h.onSync?.(id));
    await flush();
    expect(result.current.synced).toBe(true);

    emit((h) => h.onError?.(id, "forbidden: pods is forbidden"));
    await flush();
    expect(result.current.forbidden).toBe("pods is forbidden");
    expect(result.current.synced).toBe(false);
  });
});
