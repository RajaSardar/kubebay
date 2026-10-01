import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useColumnWidths } from "../useColumnWidths";

// Widths belong to a column, not a position: CRD printer columns arrive after
// the first render, and #21 will hide and reorder columns. A width set on
// "Data" must stay on "Data" when a column appears before it.

function drag(handle: { onMouseDown?: (e: never) => void }, dx: number) {
  act(() => handle.onMouseDown!({ clientX: 100, preventDefault() {}, stopPropagation() {} } as never));
  act(() => document.dispatchEvent(new MouseEvent("mousemove", { clientX: 100 + dx })));
  act(() => document.dispatchEvent(new MouseEvent("mouseup")));
}

describe("useColumnWidths", () => {
  it("starts each column at its default, 110px when it has none", () => {
    const { result } = renderHook(() => useColumnWidths({ Name: 240 }));
    expect(result.current.widthOf("Name")).toBe(240);
    expect(result.current.widthOf("Data")).toBe(110);
  });

  it("keeps a resized width on its column when columns are inserted before it", () => {
    const { result, rerender } = renderHook(() => useColumnWidths({ Name: 240 }), {
      initialProps: { ids: ["Name", "Data"] },
    });
    drag(result.current.getResizeHandleProps("Data"), 50);
    expect(result.current.widthOf("Data")).toBe(160);
    rerender({ ids: ["Name", "Phase", "Data"] });
    expect(result.current.widthOf("Data")).toBe(160);
    expect(result.current.widthOf("Phase")).toBe(110);
  });

  it("never goes below the minimum", () => {
    const { result } = renderHook(() => useColumnWidths({ Name: 240 }));
    drag(result.current.getResizeHandleProps("Name"), -500);
    expect(result.current.widthOf("Name")).toBe(60);
  });
});
