import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./shell";
import { IconInfo } from "./icons";

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

/** The page an element is part of: its ancestor directly under <body>. A
 *  dialog, a toast or an editor's popup attached to <body> is over the page,
 *  not part of it. */
function pageOf(el: HTMLElement): HTMLElement {
  let n = el;
  while (n.parentElement && n.parentElement !== n.ownerDocument.body) n = n.parentElement;
  return n;
}

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
  /** Escape closes the panel (not while typing in a field, editor or terminal),
   *  and so does a press on the page behind it. */
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // A press on the page behind the panel closes it. A press inside it, or in
  // a menu or dialog it opened, is marked on the way down (React events pass
  // through portals), so only the page's own presses reach onClose.
  const pressedInside = useRef<Event | null>(null);
  useEffect(() => {
    if (embedded) return;
    const onPress = (e: MouseEvent) => {
      const panel = ref.current;
      if (!panel || e.button !== 0 || pressedInside.current === e) return;
      const target = e.target as Node;
      if (pageOf(panel).contains(target) && !panel.contains(target)) onCloseRef.current();
    };
    document.addEventListener("mousedown", onPress);
    return () => document.removeEventListener("mousedown", onPress);
  }, [embedded]);

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
      onMouseDownCapture={(e) => {
        pressedInside.current = e.nativeEvent;
      }}
    >
      <div className="drawer-head">
        {leading}
        <div className="drawer-title">
          <div id={titleId} className="drawer-name">
            {title}
          </div>
          {subtitle != null && subtitle !== false && (
            <div className={`drawer-subtitle${subtitleMono ? " drawer-subtitle-mono" : ""}`}>{subtitle}</div>
          )}
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
  /** "center" places it as a small card near the top-centre of the window (a confirm or a one-field form). Otherwise `className` places it. */
  placement?: "center";
  /** "wide": a centred card with room for a form of file paths (560px instead of 360px). */
  size?: "wide";
  /** A visible heading, which then names the dialog, with a Close button beside it. */
  title?: ReactNode;
  children: ReactNode;
}

/**
 * A dialog that holds focus until it closes: Tab cycles inside it, Escape and a
 * click on the backdrop close it, and focus returns to where it was. It renders
 * into document.body.
 */
export function Modal({ label, onClose, className, backdrop = "dim", placement, size, title, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const focusables = () => [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
  // Start on the dialog's own first control; Close is the way out, not the way in.
  useFocusReturn(ref, true, () => focusables().find((el) => !el.closest(".kb-modal-head")) ?? focusables()[0] ?? null);

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
        aria-label={title ? undefined : label}
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`kb-modal${placement ? " " + placement : ""}${size ? " " + size : ""}${className ? " " + className : ""}`}
        onKeyDown={onKeyDown}
      >
        {title && (
          <div className="kb-modal-head">
            <h2 id={titleId} className="kb-modal-title">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose}>
              ×
            </IconButton>
          </div>
        )}
        {children}
      </div>
    </>,
    document.body,
  );
}

// ── Help tip ──────────────────────────────────────────────────────────────────

export interface HelpTipProps {
  /** The button's accessible name, and the panel's: "About Helm". */
  label: string;
  /** What the feature is and how it works, in a sentence each, and a link to its docs. */
  children: ReactNode;
  /** Which edge of the button the panel lines up with: "start" opens rightward (a
   *  title on the left), "end" opens leftward (a button at the right edge). */
  align?: "start" | "end";
}

/**
 * An ⓘ beside a feature's title that explains it (docs/HELP_TIPS_RESEARCH.md).
 * A toggletip rather than a tooltip: a click, Enter or Space opens it, so
 * keyboard and touch reach it too, and it holds a link. It stays open until
 * Escape, a press elsewhere or a second click. The panel follows its button,
 * so Tab moves into it; focus isn't moved on open.
 */
export function HelpTip({ label, children, align = "start" }: HelpTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPress = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // On the document, not the wrapper: WebKit leaves focus on the page, not
    // the button, after a click, and Escape should still close the panel.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const hadFocus = ref.current?.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) button.current?.focus();
    };
    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="kb-helptip">
      <IconButton
        ref={button}
        label={label}
        title="What is this?"
        className="kb-helptip-btn"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <IconInfo size={15} />
      </IconButton>
      {open && (
        <div id={panelId} className={`kb-helptip-panel${align === "end" ? " end" : ""}`} role="dialog" aria-modal={false} aria-label={label}>
          {children}
        </div>
      )}
    </span>
  );
}
