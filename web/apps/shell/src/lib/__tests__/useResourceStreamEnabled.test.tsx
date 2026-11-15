import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { SubSpec } from "../ws";

// A stream that starts disabled (a tab not yet open, a question not yet
// asked) subscribes once it's enabled, and lets go once it's disabled again.
const subs: SubSpec[] = [];
const unsubs: string[] = [];
vi.mock("../ws", () => ({
  attach: () => () => {},
  subscribe: (s: SubSpec) => subs.push(s),
  unsubscribe: (id: string) => unsubs.push(id),
}));

const { useResourceStream } = await import("../useResourceStream");

afterEach(() => {
  subs.length = 0;
  unsubs.length = 0;
});

describe("useResourceStream's enabled", () => {
  it("subscribes when a disabled stream is enabled, and unsubscribes when it's disabled again", () => {
    const { rerender } = renderHook(({ enabled }) => useResourceStream("kind", "policy/v1/poddisruptionbudgets", { mode: "full", enabled }), {
      initialProps: { enabled: false },
    });
    expect(subs).toEqual([]);
    rerender({ enabled: true });
    expect(subs.map((s) => s.gvr)).toEqual(["policy/v1/poddisruptionbudgets"]);
    rerender({ enabled: false });
    expect(unsubs).toEqual([subs[0]!.id]);
  });
});
