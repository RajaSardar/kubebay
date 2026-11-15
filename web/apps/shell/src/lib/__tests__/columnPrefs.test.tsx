import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useColumnPrefs } from "../useColumnPrefs";

// #21: which columns a table shows, and in what order, remembered per table
// (docs/TABLE_FOLLOWUPS.md). Name is not managed here: it is always first.

const cols = [
  { id: "Namespace" },
  { id: "Status" },
  { id: "Zone", defaultHidden: true },
  { id: "Age" },
];

describe("useColumnPrefs", () => {
  beforeEach(() => localStorage.clear());

  it("starts with the page's order and its default-hidden columns hidden", () => {
    const { result } = renderHook(() => useColumnPrefs("r/nodes", cols));
    expect(result.current.order).toEqual(["Namespace", "Status", "Zone", "Age"]);
    expect(result.current.visible).toEqual(["Namespace", "Status", "Age"]);
  });

  it("hides, shows and moves columns, and remembers it across a remount", () => {
    const first = renderHook(() => useColumnPrefs("r/nodes", cols));
    act(() => first.result.current.toggle("Status"));
    act(() => first.result.current.toggle("Zone"));
    act(() => first.result.current.move("Age", -1));
    expect(first.result.current.visible).toEqual(["Namespace", "Age", "Zone"]);
    first.unmount();
    const again = renderHook(() => useColumnPrefs("r/nodes", cols));
    expect(again.result.current.visible).toEqual(["Namespace", "Age", "Zone"]);
    expect(JSON.parse(localStorage.getItem("kb.cols.r/nodes")!)).toMatchObject({ v: 1 });
  });

  it("keeps each table's layout separate", () => {
    const nodes = renderHook(() => useColumnPrefs("r/nodes", cols));
    act(() => nodes.result.current.toggle("Status"));
    const pods = renderHook(() => useColumnPrefs("pods", cols));
    expect(pods.result.current.visible).toContain("Status");
  });

  it("adds columns that appear later at the end, and forgets ones that are gone", () => {
    const h = renderHook(({ c }) => useColumnPrefs("r/widgets", c), { initialProps: { c: cols } });
    act(() => h.result.current.move("Age", -1));
    h.rerender({ c: [{ id: "Namespace" }, { id: "Age" }, { id: "Phase" }] });
    expect(h.result.current.order).toEqual(["Namespace", "Age", "Phase"]);
  });

  it("resets to the page's layout", () => {
    const h = renderHook(() => useColumnPrefs("r/nodes", cols));
    act(() => h.result.current.toggle("Status"));
    act(() => h.result.current.reset());
    expect(h.result.current.visible).toEqual(["Namespace", "Status", "Age"]);
    expect(localStorage.getItem("kb.cols.r/nodes")).toBeNull();
  });
});
