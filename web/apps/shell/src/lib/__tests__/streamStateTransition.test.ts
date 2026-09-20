import { describe, it, expect } from "vitest";
import { applyStatusTransition } from "../useResourceStream";

// Regression tests for the stream cache vanish bug:
//
// When the WS connects (onStatus(true)), the 16 ms debounce can fire BEFORE
// onBegin arrives from the server. If synced is still true from a pre-warmed
// cache at that point, the UI briefly renders "connected=true && synced=true"
// (shows real data from stale cache), then onBegin resets synced=false and
// the content visibly vanishes.
//
// Fix: applyStatusTransition resets synced=false whenever transitioning from
// disconnected → connected, so the stale cache is never exposed.

describe("applyStatusTransition", () => {
  it("resets synced=false on reconnect (disconnected → connected)", () => {
    const next = applyStatusTransition({ synced: true, connected: false }, true);
    expect(next.synced).toBe(false);
    expect(next.connected).toBe(true);
  });

  it("preserves synced on disconnect (connected → disconnected)", () => {
    const next = applyStatusTransition({ synced: true, connected: true }, false);
    expect(next.synced).toBe(true);
    expect(next.connected).toBe(false);
  });

  it("no-op when already connected stays connected", () => {
    const next = applyStatusTransition({ synced: true, connected: true }, true);
    expect(next.synced).toBe(true);
    expect(next.connected).toBe(true);
  });

  it("reconnect with synced=false stays false", () => {
    const next = applyStatusTransition({ synced: false, connected: false }, true);
    expect(next.synced).toBe(false);
    expect(next.connected).toBe(true);
  });

  it("disconnect while synced=false stays false", () => {
    const next = applyStatusTransition({ synced: false, connected: true }, false);
    expect(next.synced).toBe(false);
    expect(next.connected).toBe(false);
  });
});
