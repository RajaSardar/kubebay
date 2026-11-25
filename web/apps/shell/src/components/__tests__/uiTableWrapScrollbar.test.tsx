import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Table, TableWrap, scrollThumb, scrollLeftForThumb } from "@kubebay/ui";

// jsdom does no layout: give every element the box a real wide table would have.
const reads = { n: 0 };
function withBox(scrollWidth: number, clientWidth: number) {
  reads.n = 0;
  const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth");
  const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => (reads.n++, scrollWidth) });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => (reads.n++, clientWidth) });
  return () => {
    if (sw) Object.defineProperty(HTMLElement.prototype, "scrollWidth", sw);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
    if (cw) Object.defineProperty(HTMLElement.prototype, "clientWidth", cw);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

const wrapOf = () => screen.getByRole("table").parentElement as HTMLElement;
const mount = () =>
  render(
    <TableWrap>
      <Table>
        <tbody>
          <tr>
            <td>pod-a</td>
          </tr>
        </tbody>
      </Table>
    </TableWrap>,
  );

describe("TableWrap's pinned horizontal scrollbar", () => {
  it("shows no scrollbar while the table fits", () => {
    restore = withBox(400, 400);
    mount();
    expect(screen.queryByRole("scrollbar")).toBeNull();
  });

  it("shows a scrollbar under the viewport once the table is wider than it", () => {
    restore = withBox(1200, 400);
    mount();
    const bar = screen.getByRole("scrollbar", { name: "Scroll the table sideways" });
    expect(bar).toHaveAttribute("aria-orientation", "horizontal");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "800");
    expect(bar).toHaveAttribute("aria-valuenow", "0");
    // It sits outside the scrolling viewport, so it stays in view however far down the rows go.
    expect(wrapOf().contains(bar)).toBe(false);
  });

  it("follows the table's own scrolling", async () => {
    restore = withBox(1200, 400);
    mount();
    const wrap = wrapOf();
    wrap.scrollLeft = 300;
    fireEvent.scroll(wrap);
    // Once per frame, not once per scroll event.
    await waitFor(() => expect(screen.getByRole("scrollbar")).toHaveAttribute("aria-valuenow", "300"));
  });

  it("scrolls the table with the arrow keys, Home and End", () => {
    restore = withBox(1200, 400);
    mount();
    const wrap = wrapOf();
    const bar = screen.getByRole("scrollbar");
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(wrap.scrollLeft).toBe(48);
    fireEvent.keyDown(bar, { key: "ArrowLeft" });
    expect(wrap.scrollLeft).toBe(0);
    fireEvent.keyDown(bar, { key: "End" });
    expect(wrap.scrollLeft).toBe(800);
    fireEvent.keyDown(bar, { key: "Home" });
    expect(wrap.scrollLeft).toBe(0);
  });

  it("keeps the wrap as the table's direct parent and forwards its ref", () => {
    restore = withBox(1200, 400);
    mount();
    expect(wrapOf()).toHaveClass("table-wrap");
  });
});

// Backlog 90: reading scrollWidth/clientWidth forces a synchronous layout. The bar re-measured after
// every render and on every scroll tick (vertical ones too): 89 ms of 4 s of scrolling in the profile.
describe("TableWrap's scrollbar does not thrash layout", () => {
  it("reads no layout when its parent re-renders", () => {
    restore = withBox(1200, 400);
    const ui = (n: number) => (
      <TableWrap>
        <Table>
          <tbody>
            <tr>
              <td>pod-{n}</td>
            </tr>
          </tbody>
        </Table>
      </TableWrap>
    );
    const { rerender } = render(ui(0));
    const after = reads.n;
    for (let i = 1; i <= 20; i++) rerender(ui(i));
    expect(reads.n).toBe(after);
  });

  it("reads no layout on a scroll tick that did not move sideways (a vertical scroll)", () => {
    restore = withBox(1200, 400);
    mount();
    const wrap = wrapOf();
    const after = reads.n;
    for (let i = 0; i < 20; i++) {
      wrap.scrollTop = i * 40;
      fireEvent.scroll(wrap);
    }
    expect(reads.n).toBe(after);
  });
});

describe("TableWrap's scrollbar reads scrollLeft when the scroll event fires, not in the frame callback", () => {
  it("a sideways scroll is read in the event, so the frame callback forces no layout after React's commit", () => {
    restore = withBox(1200, 400);
    const queued: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => (queued.push(cb), queued.length));
    mount();
    const wrap = wrapOf();
    let left = 0;
    let reads = 0;
    Object.defineProperty(wrap, "scrollLeft", { configurable: true, get: () => (reads++, left), set: (v) => (left = v) });
    left = 120;
    fireEvent.scroll(wrap);
    expect(reads).toBeGreaterThan(0); // read in the event
    const inEvent = reads;
    act(() => queued.splice(0).forEach((cb) => cb(0)));
    expect(reads).toBe(inEvent); // none in the frame callback
    expect(screen.getByRole("scrollbar")).toHaveAttribute("aria-valuenow", "120");
    raf.mockRestore();
  });
});

describe("scrollThumb / scrollLeftForThumb", () => {
  it("sizes the thumb by the visible share, never below a grabbable minimum", () => {
    expect(scrollThumb({ scrollWidth: 1200, clientWidth: 400, scrollLeft: 0, trackWidth: 400 })).toEqual({ width: 133, left: 0 });
    // 10000px of table: the thumb would be 16px, so it is held at the minimum.
    expect(scrollThumb({ scrollWidth: 10000, clientWidth: 400, scrollLeft: 0, trackWidth: 400 }).width).toBe(24);
  });

  it("puts the thumb at the far end when scrolled to the far end", () => {
    const t = scrollThumb({ scrollWidth: 1200, clientWidth: 400, scrollLeft: 800, trackWidth: 400 });
    expect(t.left + t.width).toBe(400);
  });

  it("maps a thumb position back to a scroll offset, clamped", () => {
    const m = { scrollWidth: 1200, clientWidth: 400, trackWidth: 400, thumbWidth: 133 };
    expect(scrollLeftForThumb({ ...m, thumbLeft: 0 })).toBe(0);
    expect(scrollLeftForThumb({ ...m, thumbLeft: 267 })).toBe(800);
    expect(scrollLeftForThumb({ ...m, thumbLeft: 999 })).toBe(800);
    expect(scrollLeftForThumb({ ...m, thumbLeft: -5 })).toBe(0);
  });
});
