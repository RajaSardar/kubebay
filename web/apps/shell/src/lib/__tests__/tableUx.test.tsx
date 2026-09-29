import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, renderHook } from "@testing-library/react";
import { absoluteTime, countLabel, matchesFilter, useSortPref, useTableKeyboard } from "../tableUx";
import { templateKindFor } from "../resourceTemplates";

describe("templateKindFor", () => {
  it.each([
    ["deployments", "Deployment"],
    ["statefulsets", "StatefulSet"],
    ["ingresses", "Ingress"],
    ["networkpolicies", "NetworkPolicy"],
    ["persistentvolumeclaims", "PersistentVolumeClaim"],
    ["configmaps", "ConfigMap"],
  ])("the + button on %s opens the %s template", (slug, kind) => {
    expect(templateKindFor(slug)).toBe(kind);
  });
  it("has no template for a resource the create page cannot make", () => {
    expect(templateKindFor("events")).toBeUndefined();
  });
});

describe("matchesFilter", () => {
  const pod = ["web-7f9c", "shop", "kind-worker", "10.244.0.12", "CrashLoopBackOff"];
  it("ignores case", () => expect(matchesFilter(pod, "CRASH")).toBe(true));
  it("matches any field", () => expect(matchesFilter(pod, "10.244")).toBe(true));
  it("needs every word to match somewhere", () => {
    expect(matchesFilter(pod, "shop crash")).toBe(true);
    expect(matchesFilter(pod, "shop pending")).toBe(false);
  });
  it("matches everything when empty", () => expect(matchesFilter(pod, "  ")).toBe(true));
});

describe("countLabel", () => {
  it("shows the count alone when nothing is filtered out", () => expect(countLabel(12, 12)).toBe("12"));
  it("shows shown of total when filtered", () => expect(countLabel(3, 340)).toBe("3 of 340"));
});

describe("absoluteTime", () => {
  it("formats a timestamp for an age tooltip", () => {
    expect(absoluteTime("2026-09-29T04:26:44Z")).toMatch(/2026/);
  });
  it("is empty for a missing timestamp", () => expect(absoluteTime(undefined)).toBe(""));
});

describe("useSortPref", () => {
  afterEach(() => localStorage.clear());
  it("remembers the sort for each table", () => {
    const { result, unmount } = renderHook(() => useSortPref("deployments"));
    act(() => result.current.toggle("Age"));
    act(() => result.current.toggle("Age"));
    expect(result.current).toMatchObject({ col: "Age", asc: false });
    unmount();
    const again = renderHook(() => useSortPref("deployments"));
    expect(again.result.current).toMatchObject({ col: "Age", asc: false });
    const other = renderHook(() => useSortPref("services"));
    expect(other.result.current).toMatchObject({ col: null, asc: true });
  });
});

describe("useTableKeyboard", () => {
  function setup(count = 3) {
    const onOpen = vi.fn(), onToggle = vi.fn(), onClearFilter = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    const filterRef = { current: input };
    const hook = renderHook(() => useTableKeyboard({ count, onOpen, onToggle, filterRef, onClearFilter }));
    return { hook, onOpen, onToggle, onClearFilter, input };
  }
  afterEach(() => { document.body.innerHTML = ""; });

  it("moves the active row with the arrow keys and j/k, within bounds", () => {
    const { hook } = setup(3);
    expect(hook.result.current.active).toBe(-1);
    act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
    act(() => { fireEvent.keyDown(window, { key: "j" }); });
    act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
    act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
    expect(hook.result.current.active).toBe(2);
    act(() => { fireEvent.keyDown(window, { key: "k" }); });
    expect(hook.result.current.active).toBe(1);
  });

  it("opens the active row with Enter and selects it with x", () => {
    const { hook, onOpen, onToggle } = setup(3);
    act(() => { fireEvent.keyDown(window, { key: "ArrowDown" }); });
    act(() => { fireEvent.keyDown(window, { key: "Enter" }); });
    act(() => { fireEvent.keyDown(window, { key: "x" }); });
    expect(onOpen).toHaveBeenCalledWith(0);
    expect(onToggle).toHaveBeenCalledWith(0);
    expect(hook.result.current.active).toBe(0);
  });

  it("focuses the filter with / and clears it with Escape", () => {
    const { onClearFilter, input } = setup();
    act(() => { fireEvent.keyDown(window, { key: "/" }); });
    expect(document.activeElement).toBe(input);
    act(() => { fireEvent.keyDown(input, { key: "Escape" }); });
    expect(onClearFilter).toHaveBeenCalled();
  });

  it("leaves typing alone: keys pressed in a field do not move rows", () => {
    const { hook, input } = setup();
    input.focus();
    act(() => { fireEvent.keyDown(input, { key: "j" }); });
    expect(hook.result.current.active).toBe(-1);
  });

  it("ignores keys with modifiers (⌘K belongs to the palette)", () => {
    const { hook } = setup();
    act(() => { fireEvent.keyDown(window, { key: "k", metaKey: true }); });
    act(() => { fireEvent.keyDown(window, { key: "ArrowDown", ctrlKey: true }); });
    expect(hook.result.current.active).toBe(-1);
  });
});
