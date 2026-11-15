import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useResizableColumns, MIN_COL_WIDTH } from "../useResizableColumns";

describe("useResizableColumns", () => {
  it("initialises widths from provided initial values", () => {
    const { result } = renderHook(() =>
      useResizableColumns(3, [240, 120, 80])
    );
    expect(result.current.widths).toEqual([240, 120, 80]);
  });

  it("fills missing initial widths with 120px", () => {
    const { result } = renderHook(() =>
      useResizableColumns(3, [200])
    );
    expect(result.current.widths[1]).toBe(120);
    expect(result.current.widths[2]).toBe(120);
  });

  it("setWidth updates only the target column", () => {
    const { result } = renderHook(() =>
      useResizableColumns(3, [240, 120, 80])
    );
    act(() => result.current.setWidth(0, 320));
    expect(result.current.widths[0]).toBe(320);
    expect(result.current.widths[1]).toBe(120); // unchanged
    expect(result.current.widths[2]).toBe(80);  // unchanged
  });

  it(`setWidth enforces minimum width of ${MIN_COL_WIDTH}px`, () => {
    const { result } = renderHook(() =>
      useResizableColumns(2, [200, 100])
    );
    act(() => result.current.setWidth(0, 10));
    expect(result.current.widths[0]).toBe(MIN_COL_WIDTH);
  });

  it("setWidth rounds to whole pixels", () => {
    const { result } = renderHook(() =>
      useResizableColumns(1, [200])
    );
    act(() => result.current.setWidth(0, 123.7));
    expect(result.current.widths[0]).toBe(124);
  });

  it("getResizeHandleProps returns an object with onMouseDown", () => {
    const { result } = renderHook(() =>
      useResizableColumns(2, [200, 100])
    );
    const props = result.current.getResizeHandleProps(0);
    expect(typeof props.onMouseDown).toBe("function");
  });
});
