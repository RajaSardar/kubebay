import { useCallback, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

const STEP = 16;
const BIG_STEP = 64;

export interface ResizeHandleProps {
  /** Accessible name, such as "Resize the sidebar". */
  label: string;
  /** The panel's current width, in px. */
  value: number;
  min: number;
  max: number;
  /** Where a double-click puts it back. */
  defaultValue: number;
  /** Which way the panel grows when its edge is dragged: a sidebar on the left grows "right", a drawer on the right grows "left". */
  grow: "left" | "right";
  onChange: (value: number) => void;
  /** A double-click calls this instead of `onChange(defaultValue)`, when the caller keeps "no choice made" apart from a width. */
  onReset?: () => void;
  /** Dragging this far below `min` (px) collapses the panel: `onCollapse` fires and the drag ends. */
  collapseBelow?: number;
  onCollapse?: () => void;
  /** Placement of the handle on its panel's edge. */
  className?: string;
}

/**
 * The draggable edge of a panel beside the page (the sidebar, the drawer): a vertical separator.
 * Drag it, or focus it and press ← → (16px, 64px with Shift), Home or End; a double-click puts the
 * width back. Never outside `min`..`max`. The caller owns the width: this only reports changes.
 */
export function ResizeHandle({ label, value, min, max, defaultValue, grow, onChange, onReset, collapseBelow, onCollapse, className }: ResizeHandleProps) {
  const drag = useRef<{ x: number; from: number } | null>(null);
  const sign = grow === "right" ? 1 : -1;
  const clamp = (v: number) => Math.round(Math.max(min, Math.min(max, v)));
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    let next: number;
    if (e.key === "ArrowRight") next = value + sign * step;
    else if (e.key === "ArrowLeft") next = value - sign * step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    else return;
    e.preventDefault();
    onChange(clamp(next));
  };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`kb-resize-handle${className ? " " + className : ""}`}
      onKeyDown={onKeyDown}
      onDoubleClick={() => (onReset ? onReset() : onChange(clamp(defaultValue)))}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { x: e.clientX, from: value };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const raw = d.from + sign * (e.clientX - d.x);
        if (collapseBelow != null && raw < collapseBelow && onCollapse) {
          drag.current = null;
          onCollapse();
          return;
        }
        onChange(clamp(raw));
      }}
      onPointerUp={(e) => {
        drag.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}

/**
 * A panel width that is remembered in this browser under `key`. Read once when the component
 * mounts (a window never moves under you because another window changed it), held within
 * `min`..`max`, and `defaultValue` until one has been set. `reset` forgets it.
 */
export function useStoredWidth(key: string, { min, max, defaultValue }: { min: number; max: number; defaultValue: number }) {
  const clamp = useCallback((v: number) => Math.round(Math.max(min, Math.min(max, v))), [min, max]);
  const [width, setWidthState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      const n = raw == null ? NaN : Number(raw);
      return Number.isFinite(n) ? clamp(n) : defaultValue;
    } catch {
      return defaultValue;
    }
  });
  const setWidth = useCallback(
    (next: number) => {
      const v = clamp(next);
      setWidthState(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        /* storage unavailable: keep it for this visit */
      }
    },
    [key, clamp],
  );
  const reset = useCallback(() => {
    setWidthState(defaultValue);
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }, [key, defaultValue]);
  return { width, setWidth, reset };
}
