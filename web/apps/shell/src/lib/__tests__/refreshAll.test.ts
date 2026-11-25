import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { isRefreshShortcut, refreshAll, useRefreshEpoch, REFRESH_COOLDOWN_MS, _resetRefreshForTests } from "../refreshAll";

const key = (init: KeyboardEventInit, target?: EventTarget) => {
  const e = new KeyboardEvent("keydown", { key: "r", ...init });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
};

describe("isRefreshShortcut", () => {
  it("is ⌘R on a Mac and not Ctrl+R there", () => {
    expect(isRefreshShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isRefreshShortcut(key({ ctrlKey: true }), true)).toBe(false);
  });

  it("is Ctrl+R elsewhere", () => {
    expect(isRefreshShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isRefreshShortcut(key({ ctrlKey: true, key: "R" }), false)).toBe(true);
  });

  it("leaves Shift (hard reload), Alt and other keys alone", () => {
    expect(isRefreshShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isRefreshShortcut(key({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isRefreshShortcut(key({ metaKey: true, key: "t" }), true)).toBe(false);
    expect(isRefreshShortcut(key({}), true)).toBe(false);
  });

  it("leaves Ctrl+R to a terminal, where it is the shell's history search", () => {
    const term = document.createElement("div");
    term.className = "xterm";
    const inner = document.createElement("textarea");
    term.appendChild(inner);
    document.body.appendChild(term);
    expect(isRefreshShortcut(key({ ctrlKey: true }, inner), false)).toBe(false);
    // ⌘R isn't a shell key, so it still refreshes from a terminal on a Mac.
    expect(isRefreshShortcut(key({ metaKey: true }, inner), true)).toBe(true);
    term.remove();
  });
});

describe("refreshAll", () => {
  afterEach(() => {
    vi.useRealTimers();
    _resetRefreshForTests();
  });

  it("refetches every query and bumps the stream epoch", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    const before = useRefreshEpoch.getState().epoch;
    expect(refreshAll(qc)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useRefreshEpoch.getState().epoch).toBe(before + 1);
  });

  it("ignores presses during the cooldown so holding the key can't flood the cluster", () => {
    vi.useFakeTimers();
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    expect(refreshAll(qc)).toBe(true);
    for (let i = 0; i < 20; i++) expect(refreshAll(qc)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(REFRESH_COOLDOWN_MS + 1);
    expect(refreshAll(qc)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
