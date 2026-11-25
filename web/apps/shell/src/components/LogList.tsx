import { memo, useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

/** Up to this many lines are drawn whole; more are windowed. */
export const WINDOW_AT = 300;
/** A guess for a line not yet drawn; a drawn one is measured, as lines wrap. */
const LINE_ESTIMATE = 19;

const Line = memo(function Line<T>({ item, render }: { item: T; render: (item: T) => ReactNode }) {
  return <>{render(item)}</>;
}) as <T>(p: { item: T; render: (item: T) => ReactNode }) => ReactNode;

/**
 * The scrolling body of a log view (`.log-view`). A short log is drawn whole; a long one (up to 5,000
 * lines) is windowed, so a batch of new lines costs the lines on screen rather than every line.
 * Lines are memoised by value: a batch re-renders only the lines it added. `render` must be stable.
 * With `follow` the view stays on the newest line, pinned once per frame.
 */
export function LogList<T>({
  items,
  render,
  follow,
  keyOf,
  children,
}: {
  items: readonly T[];
  render: (item: T) => ReactNode;
  follow: boolean;
  keyOf?: (item: T, index: number) => string | number;
  /** Shown above the lines: "Waiting for output…". */
  children?: ReactNode;
}) {
  const viewRef = useRef<HTMLDivElement>(null);
  const windowed = items.length > WINDOW_AT;
  const virtualizer = useVirtualizer({
    count: windowed ? items.length : 0,
    getScrollElement: () => viewRef.current,
    estimateSize: () => LINE_ESTIMATE,
    overscan: 30,
  });

  // One pin per frame however many batches landed.
  const count = items.length;
  useEffect(() => {
    if (!follow) return;
    const id = requestAnimationFrame(() => {
      if (windowed) virtualizer.scrollToIndex(count - 1, { align: "end" });
      else if (viewRef.current) viewRef.current.scrollTop = viewRef.current.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [count, follow, windowed, virtualizer]);

  return (
    <div className="log-view" ref={viewRef}>
      {children}
      {windowed ? (
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((v) => (
            <div
              key={keyOf ? keyOf(items[v.index]!, v.index) : v.index}
              data-index={v.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${v.start}px)` }}
            >
              <Line item={items[v.index]!} render={render} />
            </div>
          ))}
        </div>
      ) : (
        items.map((item, i) => <Line key={keyOf ? keyOf(item, i) : i} item={item} render={render} />)
      )}
    </div>
  );
}
