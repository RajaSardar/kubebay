import { afterEach, describe, expect, it, vi } from "vitest";
import { installBounceGuard } from "../bounceGuard";

// Root #23: a wheel listener that can cancel scrolling makes WebKit wait for
// the main thread before every scroll. CSS overscroll-behavior already stops
// the window bouncing on Safari 16 and later, so the listener is only for older
// WebKit (macOS 10.15's).

afterEach(() => vi.restoreAllMocks());

describe("installBounceGuard", () => {
  it("adds no wheel listener where CSS overscroll-behavior works", () => {
    const add = vi.spyOn(document, "addEventListener");
    expect(installBounceGuard(document, () => true)).toBe(false);
    expect(add).not.toHaveBeenCalledWith("wheel", expect.anything(), expect.anything());
  });

  it("falls back to a non-passive wheel listener on WebKit without it", () => {
    const add = vi.spyOn(document, "addEventListener");
    expect(installBounceGuard(document, () => false)).toBe(true);
    expect(add).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });
  });
});
