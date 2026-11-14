import { afterEach, describe, expect, it, vi } from "vitest";
import { isHidden, onVisible } from "../visibility";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => setVisibility("visible"));

describe("visibility", () => {
  it("knows when the page is hidden", () => {
    expect(isHidden()).toBe(false);
    setVisibility("hidden");
    expect(isHidden()).toBe(true);
  });

  it("calls back when the page becomes visible, not when it is hidden", () => {
    const cb = vi.fn();
    const stop = onVisible(cb);
    setVisibility("hidden");
    expect(cb).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
    stop();
    setVisibility("hidden");
    setVisibility("visible");
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
