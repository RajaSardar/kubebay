import { useLayoutEffect, useState, type RefObject } from "react";
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
  useLayoutEffect(() => {
    setHeader(Math.round(headerRef.current?.getBoundingClientRect().height ?? 0));
  });
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimate,
    overscan: 8,
    paddingStart: header,
    scrollPaddingStart: header,
  });
  const items = virtualizer.getVirtualItems();
  return {
    virtualizer,
    items,
    topSpace: (items[0]?.start ?? header) - header,
    bottomSpace: virtualizer.getTotalSize() - (items.at(-1)?.end ?? header),
  };
}
