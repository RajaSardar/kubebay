import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Handlers, SubSpec } from "../ws";

// A fake multiplexed socket: records subscriptions and lets the test push frames.
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

afterEach(() => {
  listeners.clear();
  subs.length = 0;
});

describe("switching a table to another resource", () => {
  it("never shows the previous resource's half-loaded rows", async () => {
    const { result, rerender } = renderHook(({ gvr }) => useResourceStream("kind", gvr, { mode: "full" }), {
      initialProps: { gvr: "apps/v1/deployments" },
    });
    const deploy = subs.at(-1)!.id;
    // Deployments start loading but have not synced when the user moves on.
    emit((h) => h.onBegin?.(deploy));
    emit((h) => h.onItems?.(deploy, [{ op: "u", key: "shop/web", obj: { metadata: { name: "web" } } }]));

    rerender({ gvr: "apps/v1/statefulsets" });
    const sts = subs.at(-1)!.id;
    expect(sts).not.toBe(deploy);
    // StatefulSets: an empty list that syncs straight away.
    emit((h) => h.onSync?.(sts));
    await flush();

    expect(result.current.synced).toBe(true);
    expect(result.current.rows).toEqual([]);
  });
});
