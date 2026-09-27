import {
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

/** A sidebar row. Router links can reuse the classes: `nav-item`, `sub`, `active`. */
export function NavItem({ label, href, icon, active, sub, onClick }: NavItemProps) {
  const cls = `nav-item${sub ? " sub" : ""}${active ? " active" : ""}`;
  return (
    <a className={cls} href={href} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon && <span className="nav-icon">{icon}</span>}
      <span>{label}</span>
    </a>
  );
}

// ── Inputs ────────────────────────────────────────────────────────────────────

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`toolbar-input${className ? " " + className : ""}`} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`toolbar-select${className ? " " + className : ""}`} {...props} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}

// ── Page header ───────────────────────────────────────────────────────────────

export function PageHeader({ title, count, actions }: { title: ReactNode; count?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>
        {title}
        {count != null && <span className="page-header-count">{count}</span>}
      </h1>
      {actions && <div className="page-header-actions">{actions}</div>}
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
