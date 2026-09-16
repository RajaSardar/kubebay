import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import "./styles.css";

export interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
}

export function Button({ children, onClick, variant = "primary", className, style, disabled }: ButtonProps) {
  const cls = `kb-btn kb-btn-${variant}${className ? " " + className : ""}`;
  return (
    <button className={cls} style={style} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Card({
  children,
  interactive,
  className,
  style,
  id,
}: {
  children: ReactNode;
  interactive?: boolean;
  className?: string;
  style?: CSSProperties;
  id?: string;
}) {
  const cls = `kb-card${interactive ? " kb-card-interactive" : ""}${className ? " " + className : ""}`;
  return (
    <div id={id} className={cls} style={style}>
      {children}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  connected: "var(--kb-status-ok)",
  degraded: "var(--kb-status-warn)",
  unreachable: "var(--kb-status-err)",
  pending: "var(--kb-status-pending)",
};

export function StatusDot({ status, pulse }: { status: string; pulse?: boolean }) {
  const color = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
  return (
    <span
      className={`kb-dot${pulse ? " kb-dot-pulse" : ""}`}
      style={{ background: color, boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 18%, transparent)` }}
      role="img"
      aria-label={status}
    />
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "ok" | "err" }) {
  const cls = tone === "ok" ? "kb-badge kb-badge-ok" : tone === "err" ? "kb-badge kb-badge-err" : "kb-badge";
  return <span className={cls}>{children}</span>;
}

export function Skeleton({ w = 120, h = 12, r }: { w?: number | string; h?: number; r?: number }) {
  return <span className="kb-skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

export interface ArmedButtonProps {
  label: string;
  confirmLabel?: string;
  variant?: "danger" | "primary";
  busy?: boolean;
  onGo: () => void;
  /** How long the armed (confirm) state stays up before auto-disarming. */
  armMs?: number;
}

/**
 * A "click to arm, click again to confirm" button: first click flips it into
 * an armed/confirm state (shown as `confirmLabel`), a second click within
 * `armMs` fires `onGo`, and it auto-disarms back to `label` if left alone.
 */
export function ArmedButton({
  label,
  confirmLabel,
  variant = "danger",
  busy,
  onGo,
  armMs = 3500,
}: ArmedButtonProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), armMs);
    return () => clearTimeout(t);
  }, [armed, armMs]);
  return (
    <Button
      variant={armed ? variant : "ghost"}
      disabled={busy}
      onClick={() => (armed ? onGo() : setArmed(true))}
    >
      {armed ? confirmLabel ?? `Confirm ${label.toLowerCase()}?` : label}
    </Button>
  );
}
