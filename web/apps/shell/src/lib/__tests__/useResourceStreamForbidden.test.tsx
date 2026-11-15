import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Handlers, SubSpec } from "../ws";

// When RBAC doesn't let this identity list a resource, the engine ends the
// subscription with "forbidden: <the API server's message>". The hook says so
// instead of leaving the page waiting for a sync that never comes.
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
const MSG = 'deployments.apps is forbidden: User "dev" cannot list resource "deployments" in API group "apps" at the cluster scope';

afterEach(() => {
  listeners.clear();
  subs.length = 0;
});

describe("a forbidden list", () => {
  it("reports the API server's message as forbidden", async () => {
    const { result } = renderHook(() => useResourceStream("kind", "apps/v1/deployments", { mode: "full" }));
    const id = subs.at(-1)!.id;
    emit((h) => h.onError?.(id, `forbidden: ${MSG}`));
    await flush();
    expect(result.current.forbidden).toBe(MSG);
    expect(result.current.synced).toBe(false);
  });

  it("ignores other subscriptions' errors and other reasons", async () => {
    const { result } = renderHook(() => useResourceStream("kind", "apps/v1/deployments", { mode: "full" }));
    const id = subs.at(-1)!.id;
    emit((h) => h.onError?.("ui-someone-else", `forbidden: ${MSG}`));
    emit((h) => h.onError?.(id, "cluster disconnected"));
    await flush();
    expect(result.current.forbidden).toBeUndefined();
  });
});
