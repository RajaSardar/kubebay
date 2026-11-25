import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { LogList } from "../LogList";

// Backlog 90: the log views rendered every line (up to 5000) and re-rendered all of them on each
// batch. A long list is windowed; a short one is drawn whole.
describe("LogList", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, value: 600 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, value: 600 });
    // jsdom does no layout: the scrolled content is every line at the estimated height.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, value: 5000 * 19 });
  });
  const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);
  const draw = (l: string) => <div className="log-line">{l}</div>;

  it("draws a short log whole", () => {
    render(<LogList items={lines(50)} render={draw} follow={false} />);
    expect(document.querySelectorAll(".log-line")).toHaveLength(50);
  });

  it("draws a window of a 5000-line log, not every line", () => {
    render(<LogList items={lines(5000)} render={draw} follow={false} />);
    const n = document.querySelectorAll(".log-line").length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(200);
  });

  it("scrolls to the newest line while following a windowed log", async () => {
    const scrollTo = vi.fn();
    const proto = HTMLElement.prototype as unknown as { scrollTo: unknown };
    const old = proto.scrollTo;
    proto.scrollTo = scrollTo;
    try {
      render(<LogList items={lines(5000)} render={draw} follow />);
      await waitFor(() => expect(scrollTo.mock.calls.at(-1)?.[0].top).toBeGreaterThan(5000 * 10));
    } finally {
      proto.scrollTo = old;
    }
  });

  it("does not re-render lines that did not change when a batch arrives", () => {
    const row = vi.fn(draw);
    const base = lines(100);
    const { rerender } = render(<LogList items={base} render={row} follow={false} />);
    row.mockClear();
    act(() => rerender(<LogList items={[...base, "line 100"]} render={row} follow={false} />));
    // Only the new line is drawn: the others keep their elements.
    expect(row.mock.calls.length).toBeLessThanOrEqual(2);
  });

  // The pod log keeps the newest 5000 lines: once full, a batch drops old lines and adds new ones, so
  // the count stays put. The view must still follow the newest line.
  it("keeps following when a full buffer rotates and the line count does not change", async () => {
    const list = lines(100);
    const { container, rerender } = render(<LogList items={list} render={draw} follow />);
    const view = container.querySelector(".log-view") as HTMLElement;
    await waitFor(() => expect(view.scrollTop).toBe(5000 * 19));
    view.scrollTop = 0; // stands for the content having grown under a view that is no longer at the bottom
    act(() => rerender(<LogList items={[...list.slice(1), "line 100"]} render={draw} follow />));
    await waitFor(() => expect(view.scrollTop).toBe(5000 * 19));
  });
});
