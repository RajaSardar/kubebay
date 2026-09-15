import { useCallback, useRef, useState } from "react";

export const MIN_COL_WIDTH = 60;

/**
 * Manages per-column pixel widths and provides drag-to-resize handles.
 *
 * @param count          Number of columns to track.
 * @param initialWidths  Preferred starting width for each column (px).
 *                       Columns without an entry default to 120px.
 */
export function useResizableColumns(count: number, initialWidths: number[]) {
  const [widths, setWidths] = useState<number[]>(() =>
    Array.from({ length: count }, (_, i) =>
      Math.max(MIN_COL_WIDTH, initialWidths[i] ?? 120)
    )
  );

  // Ref so drag handlers always read the latest widths without stale closure.
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  const setWidth = useCallback((index: number, width: number) => {
    setWidths((prev) => {
      const next = [...prev];
      next[index] = Math.max(MIN_COL_WIDTH, Math.round(width));
      return next;
    });
  }, []);

  /**
   * Returns props for the resize handle `<div>` placed at the right edge
   * of the column header.  Attaches global mousemove/mouseup listeners
   * during a drag and removes them on release.
   */
  const getResizeHandleProps = useCallback(
    (index: number): React.HTMLAttributes<HTMLDivElement> => ({
      onMouseDown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = widthsRef.current[index] ?? 120;

        const onMouseMove = (ev: MouseEvent) => {
          const newWidth = Math.max(
            MIN_COL_WIDTH,
            startWidth + (ev.clientX - startX)
          );
          setWidths((prev) => {
            const next = [...prev];
            next[index] = Math.round(newWidth);
            return next;
          });
        };

        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      },
    }),
    [] // stable — reads widths through ref
  );

  return { widths, setWidth, getResizeHandleProps };
}
