import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTableVirtualizer } from "../useTableVirtualizer";

// Rows of a virtualised table start below its sticky <thead>, but the
// virtualiser measured them from the top of the scroll area. Moving the
// active row down with the keyboard scrolled it "into view" one header-height
// short, leaving it half hidden under the bottom edge.
describe("useTableVirtualizer", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
  });
  afterEach(() => vi.restoreAllMocks());

  function setup(count: number) {
    const scroller = document.createElement("div");
    const head = document.createElement("thead");
    vi.spyOn(head, "getBoundingClientRect").mockReturnValue({ height: 34 } as DOMRect);
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as unknown as typeof scroller.scrollTo;
    // jsdom has no layout: the content is the header plus every row.
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 34 + count * 43 });
    document.body.appendChild(scroller);
    const hook = renderHook(() =>
      useTableVirtualizer({ count, estimate: 43, scrollRef: { current: scroller }, headerRef: { current: head } }),
    );
    return { hook, scrollTo, scroller };
  }

  it("scrolls a row below the fold fully into view, counting the header above the rows", () => {
    const { hook, scrollTo } = setup(100);
    act(() => hook.result.current.virtualizer.scrollToIndex(20, { align: "auto" }));
    // Row 20 ends at 34 (header) + 21 × 43 = 937px; a 600px viewport shows it at scrollTop 337.
    expect(scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 337 }));
  });

  it("puts no phantom space above the first row", () => {
    const { hook } = setup(100);
    expect(hook.result.current.topSpace).toBe(0);
    expect(hook.result.current.bottomSpace).toBeGreaterThan(0);
  });
});
