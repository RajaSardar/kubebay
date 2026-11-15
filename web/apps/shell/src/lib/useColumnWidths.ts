import { useCallback, useRef, useState } from "react";
import { MIN_COL_WIDTH } from "./useResizableColumns";

export const DEFAULT_COL_WIDTH = 110;

/**
 * Column widths keyed by column id, with drag-to-resize handles. A width stays
 * with its column when columns are added, hidden or reordered (CRD printer
 * columns arrive late; the column chooser hides and moves columns).
 */
export function useColumnWidths(defaults: Readonly<Record<string, number>>) {
  const [set, setSet] = useState<Readonly<Record<string, number>>>({});
  const setRef = useRef(set);
  setRef.current = set;
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const widthOf = useCallback(
    (id: string) => set[id] ?? Math.max(MIN_COL_WIDTH, defaults[id] ?? DEFAULT_COL_WIDTH),
    [set, defaults],
  );

  const getResizeHandleProps = useCallback(
    (id: string): React.HTMLAttributes<HTMLDivElement> => ({
      onMouseDown: (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = setRef.current[id] ?? defaultsRef.current[id] ?? DEFAULT_COL_WIDTH;
        const onMouseMove = (ev: MouseEvent) => {
          const w = Math.max(MIN_COL_WIDTH, Math.round(startWidth + (ev.clientX - startX)));
          setSet((prev) => ({ ...prev, [id]: w }));
        };
        const onMouseUp = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
        };
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      },
    }),
    [],
  );

  return { widthOf, getResizeHandleProps };
}
