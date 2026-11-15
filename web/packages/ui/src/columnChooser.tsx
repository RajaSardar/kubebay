import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./index";
import { IconButton } from "./shell";

export interface ColumnChoice {
  id: string;
  label: string;
  shown: boolean;
}

export interface ColumnChooserProps {
  /** The columns the user may manage, in their current order (not Name: it stays first). */
  columns: readonly ColumnChoice[];
  onToggle: (id: string) => void;
  onMove: (id: string, by: -1 | 1) => void;
  onReset: () => void;
}

/**
 * A "Columns" button that opens a small panel: a checkbox per column to show
 * or hide it, Move up / Move down to reorder (buttons, so keyboard and pointer
 * work alike), and Reset. Escape or a click outside closes it, and focus goes
 * back to the button.
 */
export function ColumnChooser({ columns, onToggle, onMove, onReset }: ColumnChooserProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLInputElement>("input[type=checkbox]")?.focus();
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    // Escape anywhere closes it: a Move button that just became disabled drops
    // focus to the page, out of the panel's own key handler.
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="kb-column-chooser" ref={wrapRef}>
      <Button
        ref={buttonRef}
        variant="ghost"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        Columns
      </Button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Columns"
          className="kb-column-chooser-panel"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            close(true);
          }}
        >
          <ul className="kb-column-chooser-list">
            {columns.map((c, i) => (
              <li key={c.id} className="kb-column-chooser-item">
                <label className="kb-column-chooser-label">
                  <input type="checkbox" className="kb-checkbox" checked={c.shown} onChange={() => onToggle(c.id)} />
                  <span>{c.label}</span>
                </label>
                <IconButton label={`Move ${c.label} up`} disabled={i === 0} onClick={() => onMove(c.id, -1)}>
                  ↑
                </IconButton>
                <IconButton label={`Move ${c.label} down`} disabled={i === columns.length - 1} onClick={() => onMove(c.id, 1)}>
                  ↓
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="kb-column-chooser-footer">
            <Button variant="ghost" onClick={onReset}>
              Reset columns
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
