import {
  forwardRef,
  useEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

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
}

export function Tabs<T extends string>({ tabs, active, labels, onChange, className = "tabs" }: TabsProps<T>) {
  return (
    <div className={className} role="tablist">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          className={`tab${active === t ? " active" : ""}`}
          onClick={() => onChange(t)}
        >
          {labels?.[t] ?? t}
        </button>
      ))}
    </div>
  );
}

// ── Sidebar navigation ────────────────────────────────────────────────────────

export function NavSection({ children }: { children: ReactNode }) {
  return <div className="nav-section">{children}</div>;
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

/** Row menu at a viewport point; closes on Escape, outside click, or after an item runs. */
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

  return (
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
    </div>
  );
}
