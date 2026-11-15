import { describe, expect, it, vi } from "vitest";
import { reportSmokeReady } from "../smoke";

// KB-14: in a CI smoke run the desktop app sets __KUBEBAY_SMOKE__, and the
// shell says when it has rendered so the app can exit 0.

function win(smoke: boolean, invoke?: (cmd: string, args: unknown) => Promise<unknown>) {
  return { __KUBEBAY_SMOKE__: smoke, __TAURI_INTERNALS__: invoke ? { invoke } : undefined } as unknown as Window;
}

describe("reportSmokeReady", () => {
  it("tells the desktop app the shell rendered, once", async () => {
    const invoke = vi.fn(async () => undefined);
    const w = win(true, invoke);
    reportSmokeReady(w);
    reportSmokeReady(w);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("smoke_ready", {});
  });

  it("does nothing outside a smoke run, or in a browser tab", () => {
    const invoke = vi.fn(async () => undefined);
    reportSmokeReady(win(false, invoke));
    expect(invoke).not.toHaveBeenCalled();
    expect(() => reportSmokeReady(win(true))).not.toThrow();
  });

  it("swallows a failed call rather than break the page", async () => {
    const invoke = vi.fn(async () => {
      throw new Error("not allowed");
    });
    expect(() => reportSmokeReady(win(true, invoke))).not.toThrow();
    await Promise.resolve();
  });
});

describe("useSmokeReady", () => {
  it("reports after the first paint, not during render", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useSmokeReady } = await import("../smoke");
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    const invoke = vi.fn(async () => undefined);
    Object.assign(window, { __KUBEBAY_SMOKE__: true, __TAURI_INTERNALS__: { invoke } });
    try {
      renderHook(() => useSmokeReady());
      expect(invoke).not.toHaveBeenCalled();
      frames.shift()!(0); // the frame the first render paints in
      expect(invoke).not.toHaveBeenCalled();
      frames.shift()!(0); // the next one: it has painted
      expect(invoke).toHaveBeenCalledWith("smoke_ready", {});
    } finally {
      vi.unstubAllGlobals();
      delete (window as unknown as Record<string, unknown>).__KUBEBAY_SMOKE__;
      delete (window as unknown as Record<string, unknown>).__KUBEBAY_SMOKE_SENT__;
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});
