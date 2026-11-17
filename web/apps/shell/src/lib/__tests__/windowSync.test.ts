import { describe, it, expect, vi } from "vitest";
import { SHARED_KEYS, onSharedPrefChange } from "../windowSync";

function storageEvent(key: string | null, newValue: string | null) {
  return new StorageEvent("storage", { key, newValue });
}

describe("window sync", () => {
  it("names the appearance keys that stay shared between windows", () => {
    expect(SHARED_KEYS).toEqual(["kb.theme", "kb.fontSize", "kb.fontFamily", "kb.density"]);
  });

  it("hands a changed appearance key and value to the handler", () => {
    const handler = vi.fn();
    const stop = onSharedPrefChange(handler);
    window.dispatchEvent(storageEvent("kb.theme", "dusk"));
    window.dispatchEvent(storageEvent("kb.density", "compact"));
    expect(handler).toHaveBeenNthCalledWith(1, "kb.theme", "dusk");
    expect(handler).toHaveBeenNthCalledWith(2, "kb.density", "compact");
    stop();
  });

  it("ignores window-scoped keys, cleared storage and removed values", () => {
    const handler = vi.fn();
    const stop = onSharedPrefChange(handler);
    window.dispatchEvent(storageEvent("kb.terminalDockHeight", "300"));
    window.dispatchEvent(storageEvent(null, null));
    window.dispatchEvent(storageEvent("kb.theme", null));
    expect(handler).not.toHaveBeenCalled();
    stop();
  });

  it("stops listening once stopped", () => {
    const handler = vi.fn();
    onSharedPrefChange(handler)();
    window.dispatchEvent(storageEvent("kb.theme", "dusk"));
    expect(handler).not.toHaveBeenCalled();
  });
});
