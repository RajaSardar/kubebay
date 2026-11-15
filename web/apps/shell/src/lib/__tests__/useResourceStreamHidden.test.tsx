import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Handlers, SubSpec } from "../ws";

// A window nobody can see (minimised, hidden) has no use for re-rendering a
// table on every stream update: the rows keep arriving in the store, and what
// is on screen catches up the moment the window is shown again.
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
const flush = () => act(() => new Promise((r) => setTimeout(r, 40)));
const pod = (name: string) => ({ op: "u" as const, key: `shop/${name}`, obj: { metadata: { name, namespace: "shop" } } });

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  Object.defineProperty(document, "hidden", { value: state === "hidden", configurable: true });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

afterEach(() => {
  setVisibility("visible");
  listeners.clear();
  subs.length = 0;
});

describe("a stream in a window nobody can see", () => {
  it("does not re-render for updates, and shows them all once the window is visible", async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useResourceStream("kind", "v1/pods", { mode: "full" });
    });
    const id = subs.at(-1)!.id;
    emit((h) => h.onBegin?.(id));
    emit((h) => h.onItems?.(id, [pod("a")]));
    emit((h) => h.onSync?.(id));
    await flush();
    expect(result.current.rows).toHaveLength(1);

    setVisibility("hidden");
    const before = renders;
    emit((h) => h.onDelta?.(id, [pod("b")]));
    emit((h) => h.onDelta?.(id, [pod("c")]));
    emit((h) => h.onDelta?.(id, [pod("d")]));
    await flush();
    expect(renders).toBe(before);
    expect(result.current.rows).toHaveLength(1);

    setVisibility("visible");
    await flush();
    expect(result.current.rows.map((r) => (r.metadata as { name: string }).name).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("shows nothing extra on becoming visible when nothing arrived meanwhile", async () => {
    let renders = 0;
    renderHook(() => {
      renders++;
      return useResourceStream("kind", "v1/pods", { mode: "full" });
    });
    await flush();
    setVisibility("hidden");
    const before = renders;
    setVisibility("visible");
    await flush();
    expect(renders).toBe(before);
  });

  it("is unchanged while the window is visible: updates show at once", async () => {
    const { result } = renderHook(() => useResourceStream("kind", "v1/pods", { mode: "full" }));
    const id = subs.at(-1)!.id;
    emit((h) => h.onBegin?.(id));
    emit((h) => h.onItems?.(id, [pod("a")]));
    emit((h) => h.onSync?.(id));
    emit((h) => h.onDelta?.(id, [pod("b")]));
    await flush();
    expect(result.current.rows).toHaveLength(2);
  });
});
