import {
  forwardRef,
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";

// ── Icon button ───────────────────────────────────────────────────────────────

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> {
  /** Accessible name; also the tooltip unless `title` is given. */
  label: string;
  /** Pressed state for toggles (split view, favourite). */
  active?: boolean;
  children: ReactNode;
}

/** A square, icon-only button: close, back, row menu, pop-out, star. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, title, className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      aria-pressed={active === undefined ? undefined : active}
      className={`kb-icon-btn${active ? " active" : ""}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </button>
  );
});

// ── Segmented control ─────────────────────────────────────────────────────────

export interface SegmentedControlProps<T extends string> {
  /** Accessible name of the group. */
  label: string;
  options: readonly { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

/** A row of mutually exclusive choices (a view switch, a size or density picker). */
export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: SegmentedControlProps<T>) {
  const move = (e: ReactKeyboardEvent, step: number) => {
    e.preventDefault();
    const i = options.findIndex((o) => o.value === value);
    const n = (i + step + options.length) % options.length;
    const next = options[n];
    if (!next) return;
    onChange(next.value);
    // Focus follows the selection, as in a native radio group.
    (e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[n])?.focus();
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") move(e, 1);
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") move(e, -1);
  };
  return (
    <div role="radiogroup" aria-label={label} className={`kb-segmented${className ? " " + className : ""}`} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={`kb-segment${o.value === value ? " active" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Status pill ───────────────────────────────────────────────────────────────

export type StatusTone = "ok" | "warn" | "err" | "pending" | "terminated" | "terminating";

/** The phase pill used in resource tables. Always carries the phase word. */
export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={`status-${tone}`}>{children}</span>;
}

/** Pod phase → pill tone, as the Pods table shows it. Unknown phases get no pill. */
export function phaseTone(phase: string): StatusTone | undefined {
  switch (phase) {
    case "Running": return "ok";
    case "Succeeded": return "terminated";
    case "Failed": return "err";
    case "Pending": return "pending";
    case "Terminating": return "terminating";
    default: return undefined;
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export interface TabsProps<T extends string> {
  tabs: readonly T[];
  active: T;
  /** Display label per tab; defaults to the tab id. */
  labels?: Partial<Record<T, string>>;
  onChange: (tab: T) => void;
  /** Container class; defaults to "tabs". Drawer panes use "drawer-pane-tabs". */
  className?: string;
  style?: CSSProperties;
  /** Controls at the end of the tab row, outside the tab list. */
  trailing?: ReactNode;
}

export function Tabs<T extends string>({ tabs, active, labels, onChange, className = "tabs", style, trailing }: TabsProps<T>) {
  const buttons = tabs.map((t) => (
    <button
      key={t}
      type="button"
      role="tab"
      aria-selected={active === t}
      className={`tab${active === t ? " active" : ""}`}
      onClick={() => onChange(t)}
    >
      {labels?.[t] ?? t}
    </button>
  ));
  if (trailing == null) {
    return (
      <div className={className} role="tablist" style={style}>
        {buttons}
      </div>
    );
  }
  // Controls that sit in the tab row (a container picker) stay outside the tablist.
  return (
    <div className={className} style={style}>
      <div role="tablist" style={{ display: "contents" }}>
        {buttons}
      </div>
      {trailing}
    </div>
  );
}

// ── Sidebar navigation ────────────────────────────────────────────────────────

export function NavSection({ children }: { children: ReactNode }) {
  return <div className="nav-section">{children}</div>;
}

export interface DisclosureButtonProps {
  /** Whether the section this button controls is expanded. */
  open: boolean;
  onToggle: () => void;
  icon?: ReactNode;
  /** How many items the section holds, shown before the chevron. */
  count?: number;
  /** "sub" for a group nested inside another. */
  level?: "group" | "sub";
  children: ReactNode;
}

/** The header of a collapsible sidebar group: label, optional count, chevron. */
export function DisclosureButton({ open, onToggle, icon, count, level = "group", children }: DisclosureButtonProps) {
  return (
    <button
      type="button"
      className={level === "sub" ? "nav-subgroup-title" : "nav-group-title"}
      aria-expanded={open}
      onClick={onToggle}
    >
      {icon != null && <span className="nav-icon">{icon}</span>}
      <span>{children}</span>
      {count != null && <span className="nav-group-count">{count}</span>}
      <svg className="chev" viewBox="0 0 10 10" width="10" height="10" fill="none" aria-hidden="true">
        <path d="M3 2l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export interface ChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** The option this card stands for is the current choice. */
  selected: boolean;
}

/** One option in a grid of cards where exactly one is chosen (themes, presets). */
export function ChoiceCard({ selected, className, children, ...props }: ChoiceCardProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`kb-choice-card${selected ? " active" : ""}${className ? " " + className : ""}`}
      {...props}
    >
      {children}
    </button>
  );
}

export interface NavItemProps {
  label: ReactNode;
  href?: string;
  icon?: ReactNode;
  active?: boolean;
  /** Second-level item inside a nav group. */
  sub?: boolean;
  onClick?: () => void;
}

/** Class list for a sidebar row; router links (NavLink) use it so they match NavItem. */
export function navItemClass({ active, sub, extra }: { active?: boolean; sub?: boolean; extra?: string }) {
  return `nav-item${sub ? " sub" : ""}${active ? " active" : ""}${extra ? " " + extra : ""}`;
}

/** A sidebar row. */
export function NavItem({ label, href, icon, active, sub, onClick }: NavItemProps) {
  return (
    <a className={navItemClass({ active, sub })} href={href} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon && <span className="nav-icon">{icon}</span>}
      <span>{label}</span>
    </a>
  );
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextField({ className, ...props }, ref) {
    return <input ref={ref} className={`toolbar-input${className ? " " + className : ""}`} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={`toolbar-select${className ? " " + className : ""}`} {...props} />;
  },
);

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

// ── Page header ───────────────────────────────────────────────────────────────

export interface PageHeaderProps {
  title: ReactNode;
  /** Secondary count after the title, e.g. "· 128" or "12 configured". */
  count?: ReactNode;
  /** Shows the pulsing "live" pill once the page's stream has synced. */
  live?: boolean;
  /** Right-hand group: badges, selection counts, buttons. */
  actions?: ReactNode;
  /** Heading element; both levels look the same. Default 1. */
  level?: 1 | 2;
}

export function PageHeader({ title, count, live, actions, level = 1 }: PageHeaderProps) {
  const Heading = level === 2 ? "h2" : "h1";
  return (
    <div className="page-header">
      <Heading>
        {title}
        {count != null && count !== false && <span className="page-header-count">{count}</span>}
        {live && <span className="live-pill">live</span>}
      </Heading>
      {actions != null && actions !== false && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

// ── Context menu ──────────────────────────────────────────────────────────────

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

/**
 * Row menu at a viewport point; closes on Escape, outside click, or after an item runs.
 * It renders into document.body: inside a pressed table row (tr.row-clickable:active
 * scales it) a fixed menu would be placed against the row and jump under the pointer
 * between press and release, so the click would miss its item.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  // Clamp to viewport
  const clampedX = Math.min(x, window.innerWidth - 200);
  const clampedY = Math.min(y, window.innerHeight - items.length * 32);

  return createPortal(
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: clampedX, top: clampedY }}>
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} className="ctx-separator" role="separator" />;
        }
        return (
          <button
            key={i}
            role="menuitem"
            aria-disabled={item.disabled || undefined}
            className={`ctx-item${item.danger ? " danger" : ""}${item.disabled ? " disabled" : ""}`}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
          >
            {item.icon && <span className="ctx-icon">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
