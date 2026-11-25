import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** The thumb is never thinner than this, however long the table: it stays grabbable. */
const MIN_THUMB = 24;
/** Arrow keys scroll by this much. */
const KEY_STEP = 48;

/** Where the thumb sits in its track for a scroll offset. Whole pixels. */
export function scrollThumb(m: { scrollWidth: number; clientWidth: number; scrollLeft: number; trackWidth: number }) {
  const range = m.scrollWidth - m.clientWidth;
  const width = Math.min(m.trackWidth, Math.max(MIN_THUMB, Math.round((m.trackWidth * m.clientWidth) / Math.max(1, m.scrollWidth))));
  const left = range > 0 ? Math.round(((m.trackWidth - width) * m.scrollLeft) / range) : 0;
  return { width, left };
}

/** The scroll offset a thumb position stands for, clamped to the scrollable range. */
export function scrollLeftForThumb(m: { scrollWidth: number; clientWidth: number; trackWidth: number; thumbWidth: number; thumbLeft: number }) {
  const range = m.scrollWidth - m.clientWidth;
  const travel = m.trackWidth - m.thumbWidth;
  if (range <= 0 || travel <= 0) return 0;
  return Math.max(0, Math.min(range, Math.round((m.thumbLeft / travel) * range)));
}

interface Measure {
  scrollWidth: number;
  clientWidth: number;
  scrollLeft: number;
}

/**
 * A horizontal scrollbar for `target`, drawn in the page rather than by the OS, so it is always
 * on screen (macOS hides its own until you scroll) and always at the foot of the viewport it
 * scrolls, however far down the rows go. It shows only while the target overflows sideways.
 * Drag the thumb, click the track to page, or use Left/Right/Home/End.
 */
export const HScrollBar = memo(function HScrollBar({ target, label = "Scroll sideways" }: { target: HTMLElement | null; label?: string }) {
  const barRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const [m, setM] = useState<Measure>({ scrollWidth: 0, clientWidth: 0, scrollLeft: 0 });

  // Reading scrollWidth/clientWidth forces a synchronous layout, so it is done only when the
  // target or its table changes size (ResizeObserver) and on an explicit jump, never per render
  // or per scroll tick. A scroll tick reads scrollLeft alone.
  const measure = () => {
    if (!target) return;
    const next = { scrollWidth: target.scrollWidth, clientWidth: target.clientWidth, scrollLeft: target.scrollLeft };
    setM((p) => (p.scrollWidth === next.scrollWidth && p.clientWidth === next.clientWidth && p.scrollLeft === next.scrollLeft ? p : next));
  };

  useLayoutEffect(measure, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!target) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const scrollLeft = target.scrollLeft;
        setM((p) => (p.scrollLeft === scrollLeft ? p : { ...p, scrollLeft }));
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(target);
      for (const c of Array.from(target.children)) ro.observe(c);
    }
    return () => {
      target.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const range = m.scrollWidth - m.clientWidth;
  if (!target || range <= 0) return null;

  const trackWidth = barRef.current?.clientWidth || m.clientWidth;
  const thumb = scrollThumb({ ...m, trackWidth });
  const scrollTo = (x: number) => {
    target.scrollLeft = Math.max(0, Math.min(range, x));
    measure();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const to: Record<string, number> = {
      ArrowLeft: target.scrollLeft - KEY_STEP,
      ArrowRight: target.scrollLeft + KEY_STEP,
      PageUp: target.scrollLeft - m.clientWidth,
      PageDown: target.scrollLeft + m.clientWidth,
      Home: 0,
      End: range,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    scrollTo(to[e.key]!);
  };

  const onThumbDown = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    drag.current = { x: e.clientX, left: thumb.left };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onThumbMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    scrollTo(scrollLeftForThumb({ ...m, trackWidth, thumbWidth: thumb.width, thumbLeft: d.left + e.clientX - d.x }));
  };
  const onThumbUp = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  // A click on the bare track pages toward the click.
  const onTrackDown = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    scrollTo(target.scrollLeft + (e.clientX - box.left < thumb.left ? -m.clientWidth : m.clientWidth));
  };

  return (
    <div
      ref={barRef}
      className="kb-hscroll"
      role="scrollbar"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={range}
      aria-valuenow={Math.round(m.scrollLeft)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onTrackDown}
    >
      <div
        className="kb-hscroll-thumb"
        style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
});
