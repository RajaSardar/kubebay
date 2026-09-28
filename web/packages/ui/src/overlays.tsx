import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Keys typed here belong to the control, not the panel: Escape in a field
// clears or cancels it, and in the terminal or YAML editor it is the user's
// (vim, completion popups).
const KEEPS_ESCAPE = "input, textarea, select, [contenteditable='true'], .xterm, .monaco-editor";

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Moves focus into `ref` on mount and back to whatever had it on unmount. */
function useFocusReturn(ref: RefObject<HTMLElement>, enabled: boolean, initial: () => HTMLElement | null) {
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    if (!ref.current?.contains(document.activeElement)) (initial() ?? ref.current)?.focus();
    return () => {
      if (previous && document.contains(previous)) previous.focus();
    };
    // Runs once per mount: the panel owns focus for its lifetime.
  }, [enabled]);
}

// ── Drawer ────────────────────────────────────────────────────────────────────

export interface DrawerProps {
  /** Resource name or heading; also the panel's accessible name. */
  title: ReactNode;
  /** Namespace or a one-line description under the title. */
  subtitle?: ReactNode;
  /** Set the subtitle in the mono face (default) for identifiers. */
  subtitleMono?: boolean;
  /** A status dot or icon before the title. */
  leading?: ReactNode;
  /** Buttons at the end of the head: pop-out, Delete, Close. */
  actions?: ReactNode;
  /** Escape closes the panel (not while typing in a field, editor or terminal). */
  onClose: () => void;
  /** Fill the page instead of sliding over it (the full-page resource view). */
  embedded?: boolean;
  children?: ReactNode;
}

/** The side panel for one resource: a head (status, title, actions) over its content. */
export function Drawer({ title, subtitle, subtitleMono = true, leading, actions, onClose, embedded, children }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusReturn(ref, !embedded, () => null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (embedded || e.key !== "Escape" || e.defaultPrevented) return;
    if ((e.target as HTMLElement).closest(KEEPS_ESCAPE)) return;
    e.stopPropagation();
    onClose();
  };

  return (
    <aside
      ref={ref}
      className={`drawer${embedded ? " embedded" : ""}`}
      role={embedded ? "region" : "dialog"}
      aria-modal={embedded ? undefined : false}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="drawer-head">
        {leading}
        <div className="drawer-title">
          <div id={titleId} className="mono strong">
            {title}
          </div>
          {subtitle != null && subtitle !== false && <div className={`muted small${subtitleMono ? " mono" : ""}`}>{subtitle}</div>}
        </div>
        {actions != null && actions !== false && <div className="drawer-head-actions">{actions}</div>}
      </div>
      {children}
    </aside>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

export interface ModalProps {
  /** Accessible name of the dialog. */
  label: string;
  onClose: () => void;
  /** Placement and size come from this class (a popover next to its trigger, a centred card). */
  className?: string;
  /** "dim" (default) shades the page; "clear" only catches clicks, for popovers. */
  backdrop?: "dim" | "clear";
  children: ReactNode;
}

/**
 * A dialog that holds focus until it closes: Tab cycles inside it, Escape and a
 * click on the backdrop close it, and focus returns to where it was. It renders
 * into document.body.
 */
export function Modal({ label, onClose, className, backdrop = "dim", children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  useFocusReturn(ref, true, () => focusables()[0] ?? null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // Portalled to <body>: an ancestor with a transform, filter or backdrop-filter
  // (the translucent cluster strip) would otherwise become the containing block
  // for these fixed elements and clip or misplace them.
  return createPortal(
    <>
      <div className={`kb-modal-backdrop${backdrop === "clear" ? " clear" : ""}`} onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className={`kb-modal${className ? " " + className : ""}`}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
