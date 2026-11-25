import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./shell";
import { IconInfo } from "./icons";
import { ResizeHandle, useStoredWidth } from "./resize";

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

interface DrawerInsetValue {
  bottom: number;
  keepOpenIn?: RefObject<HTMLElement | null>;
}

const DrawerInsetContext = createContext<DrawerInsetValue>({ bottom: 0 });

export interface DrawerInsetProps {
  /** How far above the window's bottom edge drawers end, in px: the top of a
   *  panel docked under the page. 0 leaves them full height. */
  bottom: number;
  /** A press in this element isn't a press on the page behind a drawer, so it
   *  leaves the drawer open. */
  keepOpenIn?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * Makes room for a panel docked under the page (ADR 0005: the terminal dock):
 * every Drawer inside ends above it, and a press in it doesn't close them.
 */
export function DrawerInset({ bottom, keepOpenIn, children }: DrawerInsetProps) {
  const value = useMemo(() => ({ bottom, keepOpenIn }), [bottom, keepOpenIn]);
  return <DrawerInsetContext.Provider value={value}>{children}</DrawerInsetContext.Provider>;
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
  /** The resource's bare name: adds a "Copy name" button after the title that copies it. */
  copyName?: string;
  /** Extra controls right after the name and its Copy button, such as a favourite star. */
  nameExtra?: ReactNode;
  /** Fill the page instead of sliding over it (the full-page resource view). */
  embedded?: boolean;
  children?: ReactNode;
}

/** The drawer's narrowest width, and the share of the window it may take at most. */
const DRAWER_MIN_W = 360;
const DRAWER_MAX_SHARE = 0.9;
/** Its width until you drag it: 820px, or three quarters of a narrow window (the old `min(820px, 75vw)`). */
const DRAWER_DEFAULT_W = 820;
const DRAWER_DEFAULT_SHARE = 0.75;

/** The side panel for one resource: a head (status, title, actions) over its content. Drag its left edge to resize it. */
export function Drawer({ title, subtitle, subtitleMono = true, leading, actions, onClose, copyName, nameExtra, embedded, children }: DrawerProps) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard?.writeText(copyName ?? "").then(
      () => setCopied(true),
      () => {},
    );
  };
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useFocusReturn(ref, !embedded, () => null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const inset = useContext(DrawerInsetContext);
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  const maxW = Math.max(DRAWER_MIN_W, Math.floor(vw * DRAWER_MAX_SHARE));
  const defaultW = Math.max(DRAWER_MIN_W, Math.min(DRAWER_DEFAULT_W, Math.round(vw * DRAWER_DEFAULT_SHARE)));
  const size = useStoredWidth("kb.drawer.width", { min: DRAWER_MIN_W, max: maxW, defaultValue: defaultW });
  const insetRef = useRef(inset);
  insetRef.current = inset;

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
      if (insetRef.current.keepOpenIn?.current?.contains(target)) return;
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
      style={embedded ? undefined : { width: size.width, ...(inset.bottom > 0 ? { bottom: inset.bottom } : null) }}
      onKeyDown={onKeyDown}
      onMouseDownCapture={(e) => {
        pressedInside.current = e.nativeEvent;
      }}
    >
      {!embedded && (
        <ResizeHandle
          className="drawer-resize"
          label="Resize the panel"
          grow="left"
          value={size.width}
          min={DRAWER_MIN_W}
          max={maxW}
          defaultValue={defaultW}
          onChange={size.setWidth}
          onReset={size.reset}
        />
      )}
      <div className="drawer-head">
        {leading}
        <div className="drawer-title">
          <div className="drawer-name-row">
            <div id={titleId} className="drawer-name">
              {title}
            </div>
            {copyName && (
              <IconButton size="lg" label={copied ? "Copied" : "Copy name"} onClick={copy}>
                <svg width="18" height="18" viewBox="0 0 14 14" fill="none" aria-hidden>
                  {copied ? (
                    <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  ) : (
                    <>
                      <rect x="4.5" y="4.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
                      <path d="M9.5 2.5h-6a1 1 0 0 0-1 1v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </IconButton>
            )}
            {nameExtra}
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
  /** "wide": a centred card with room for a form of file paths (560px instead of 360px). "full": nearly the whole window, for an editor or a diff. */
  size?: "wide" | "full";
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

// ── Popover ───────────────────────────────────────────────────────────────────

export interface PopoverProps {
  /** The panel's accessible name: "Scale replicas". */
  label: string;
  /** What the button shows. It is the button's name unless `triggerLabel` is given. */
  trigger: ReactNode;
  /** The button's accessible name, when its text alone is not enough. */
  triggerLabel?: string;
  /** What the panel holds: fields, chips, a slider. */
  children: ReactNode;
  /** Which edge of the button the panel lines up with before it flips to fit. */
  align?: "start" | "end";
  /** Tells the caller when it opens or closes; the panel's contents stay the caller's. */
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

/**
 * A button that opens a panel of controls beside it (the Scale control's slider and
 * chips). Built like `HelpTip`, inline and not in a portal, so a `Drawer` around it
 * sees a press in the panel as its own and the panel scrolls with the page. It opens
 * with focus on its first field, closes on Escape (the first press never reaches the
 * Drawer) or a press elsewhere, and hands focus back to the button after Escape. It
 * flips to the other side or upward when it would run out of its container. Closing it
 * keeps whatever the caller holds; the panel owns no state.
 */
export function Popover({ label, trigger, triggerLabel, children, align = "start", onOpenChange, className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false); // opposite side to `align`
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;
  const change = (next: boolean) => {
    setOpen(next);
    notify.current?.(next);
  };
  const close = (returnFocus: boolean) => {
    const hadFocus = ref.current?.contains(document.activeElement);
    change(false);
    if (returnFocus || hadFocus) button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false);
      setUp(false);
      return;
    }
    const el = panel.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const host = ref.current?.closest(".drawer") as HTMLElement | null;
    const bounds = host ? host.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    setFlipped(align === "end" ? r.left < bounds.left : r.right > bounds.right);
    const b = button.current?.getBoundingClientRect();
    setUp(r.bottom > window.innerHeight && !!b && b.top - r.height > 0);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPress = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close(false);
    };
    // The wrapper's own handler takes Escape from inside; this one is for focus left on the page.
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close(false);
    };
    document.addEventListener("mousedown", onPress);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const atEnd = (align === "end") !== flipped;
  return (
    <span
      ref={ref}
      className={`kb-popover${className ? " " + className : ""}`}
      onKeyDown={(e) => {
        if (!open || e.key !== "Escape") return;
        // The first Escape closes the panel; the Drawer around it keeps its place.
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }}
    >
      <button
        ref={button}
        type="button"
        className="kb-btn kb-btn-ghost kb-popover-btn"
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => change(!open)}
      >
        {trigger}
        <span className="kb-popover-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div
          ref={panel}
          id={panelId}
          className={`kb-popover-panel${atEnd ? " end" : ""}${up ? " up" : ""}`}
          role="dialog"
          aria-modal={false}
          aria-label={label}
        >
          {children}
        </div>
      )}
    </span>
  );
}
