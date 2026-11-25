import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/**
 * Windowed rows for a table under a sticky header. The rows start below the
 * <thead>, so the header's height is padding before the first row: without
 * it, scrolling a row "into view" falls one header short at the bottom edge,
 * and scrolling up tucks the row under the sticky header.
 *
 * Returns the rows to mount and the space the unmounted rows above and below
 * them take (for VirtualSpacer rows).
 */
export function useTableVirtualizer({
  count,
  estimate,
  scrollRef,
  headerRef,
}: {
  count: number;
  estimate: number;
  scrollRef: RefObject<HTMLElement | null>;
  headerRef: RefObject<HTMLElement | null>;
}) {
  const [header, setHeader] = useState(0);
  // Measured when the <thead> appears and when it changes size (ResizeObserver), not after every
  // render: getBoundingClientRect forces a synchronous layout, and this renders on every scroll tick.
  const observed = useRef<{ el: HTMLElement; ro?: ResizeObserver } | null>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (el === (observed.current?.el ?? null)) return;
    observed.current?.ro?.disconnect();
    observed.current = null;
    if (!el) return;
    const read = () => setHeader(Math.round(el.getBoundingClientRect().height));
    read();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(read) : undefined;
    ro?.observe(el);
    observed.current = { el, ro };
  });
  useEffect(() => () => observed.current?.ro?.disconnect(), []);
  // Rows are one fixed height (nowrap cells), so none is observed: a ResizeObserver per row made every
  // row that mounted while scrolling re-render the whole list. `estimate` is the CSS height; the first
  // row to render says what the browser made of it (the hairline border adds a pixel), once per density.
  const [rowSize, setRowSize] = useState<{ estimate: number; px: number }>({ estimate, px: estimate });
  const rowH = rowSize.estimate === estimate ? rowSize.px : estimate;
  const measuredFor = useRef(0);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowH,
    overscan: 8,
    paddingStart: header,
    scrollPaddingStart: header,
  });
  useLayoutEffect(() => {
    if (measuredFor.current === estimate) return;
    const rows = scrollRef.current?.querySelectorAll("tbody tr[data-index]");
    const row = rows?.[1] ?? rows?.[0];
    if (!row) return;
    measuredFor.current = estimate;
    const px = Math.round(row.getBoundingClientRect().height);
    if (px > 0 && px !== rowH) setRowSize({ estimate, px });
  });
  const { measure } = virtualizer;
  const appliedH = useRef(rowH);
  useLayoutEffect(() => {
    if (appliedH.current === rowH) return;
    appliedH.current = rowH;
    measure(); // the size cache holds the old estimate
  }, [rowH, measure]);
  const items = virtualizer.getVirtualItems();
  return {
    virtualizer,
    items,
    topSpace: (items[0]?.start ?? header) - header,
    bottomSpace: virtualizer.getTotalSize() - (items.at(-1)?.end ?? header),
  };
}
