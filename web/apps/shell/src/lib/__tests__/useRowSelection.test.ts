import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRowSelection } from "../useRowSelection";

describe("useRowSelection", () => {
  it("starts with an empty selection", () => {
    const { result } = renderHook(() => useRowSelection());
    expect(result.current.selectedKeys.size).toBe(0);
  });

  it("toggleRow adds a key when not selected", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.toggleRow("ns/pod-1"));
    expect(result.current.selectedKeys.has("ns/pod-1")).toBe(true);
  });

  it("toggleRow removes a key when already selected", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.toggleRow("ns/pod-1"));
    act(() => result.current.toggleRow("ns/pod-1"));
    expect(result.current.selectedKeys.has("ns/pod-1")).toBe(false);
  });

  it("selectAll selects exactly the provided keys", () => {
    const { result } = renderHook(() => useRowSelection());
    const keys = ["ns/pod-1", "ns/pod-2", "ns/pod-3"];
    act(() => result.current.selectAll(keys));
    expect(result.current.selectedKeys.size).toBe(3);
    keys.forEach((k) => expect(result.current.selectedKeys.has(k)).toBe(true));
  });

  it("clearAll empties the selection", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.selectAll(["ns/pod-1", "ns/pod-2"]));
    act(() => result.current.clearAll());
    expect(result.current.selectedKeys.size).toBe(0);
  });

  it("isAllSelected returns true when every key is selected", () => {
    const { result } = renderHook(() => useRowSelection());
    const keys = ["ns/pod-1", "ns/pod-2"];
    act(() => result.current.selectAll(keys));
    expect(result.current.isAllSelected(keys)).toBe(true);
  });

  it("isAllSelected returns false when only some keys are selected", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.selectAll(["ns/pod-1"]));
    expect(result.current.isAllSelected(["ns/pod-1", "ns/pod-2"])).toBe(false);
  });

  it("isAllSelected returns false for an empty keys array", () => {
    const { result } = renderHook(() => useRowSelection());
    expect(result.current.isAllSelected([])).toBe(false);
  });

  it("isIndeterminate returns true when only some keys are selected", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.selectAll(["ns/pod-1"]));
    expect(result.current.isIndeterminate(["ns/pod-1", "ns/pod-2"])).toBe(true);
  });

  it("isIndeterminate returns false when none are selected", () => {
    const { result } = renderHook(() => useRowSelection());
    expect(result.current.isIndeterminate(["ns/pod-1", "ns/pod-2"])).toBe(false);
  });

  it("isIndeterminate returns false when all are selected", () => {
    const { result } = renderHook(() => useRowSelection());
    const keys = ["ns/pod-1", "ns/pod-2"];
    act(() => result.current.selectAll(keys));
    expect(result.current.isIndeterminate(keys)).toBe(false);
  });

  // KB-02: the select-all box asks on every render, scrolling included, so
  // with nothing selected it mustn't walk 100k rows' keys to say no.
  it("answers for an empty selection without walking the keys", () => {
    const { result } = renderHook(() => useRowSelection());
    const keys = Array.from({ length: 100_000 }, (_, i) => `ns/pod-${i}`);
    const every = vi.spyOn(keys, "every");
    const filter = vi.spyOn(keys, "filter");
    expect(result.current.isAllSelected(keys)).toBe(false);
    expect(result.current.isIndeterminate(keys)).toBe(false);
    expect(every).not.toHaveBeenCalled();
    expect(filter).not.toHaveBeenCalled();
  });

  it("deselect removes only the given keys", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.selectAll(["ns/pod-1", "ns/pod-2", "ns/pod-3"]));
    act(() => result.current.deselect(["ns/pod-2"]));
    expect(result.current.selectedKeys.has("ns/pod-1")).toBe(true);
    expect(result.current.selectedKeys.has("ns/pod-2")).toBe(false);
    expect(result.current.selectedKeys.has("ns/pod-3")).toBe(true);
  });
});
