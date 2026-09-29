import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import "./styles.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one action a view is for; ghost = everything else; danger = a confirmed destructive action;
   *  danger-ghost = the first, unconfirmed step of one. */
  variant?: "primary" | "ghost" | "danger" | "danger-ghost";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, variant = "primary", className, type = "button", ...props },
  ref,
) {
  const v = variant === "danger-ghost" ? "ghost kb-btn-danger-ghost" : variant;
  const cls = `kb-btn kb-btn-${v}${className ? " " + className : ""}`;
  return (
    <button ref={ref} type={type} className={cls} {...props}>
      {children}
    </button>
  );
});

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
  ok: "var(--kb-status-ok)",
  warn: "var(--kb-status-warn)",
  err: "var(--kb-status-err)",
  connected: "var(--kb-status-ok)",
  degraded: "var(--kb-status-warn)",
  unreachable: "var(--kb-status-err)",
  pending: "var(--kb-status-pending)",
};

/** Colour of chart series `i`: cycles through the theme's five `--kb-chart-*` tokens. */
export function chartColor(i: number): string {
  return `var(--kb-chart-${(((i % 5) + 5) % 5) + 1})`;
}

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

export type BadgeTone = "ok" | "warn" | "err" | "info";

/** Mono chip for identifiers and short facts. `tone` tints it; no tone is neutral. */
export function Badge({ children, tone, title }: { children: ReactNode; tone?: BadgeTone; title?: string }) {
  return <span className={tone ? `kb-badge kb-badge-${tone}` : "kb-badge"} title={title}>{children}</span>;
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

export * from "./shell";
export * from "./table";
export * from "./brand";
export * from "./overlays";
export * from "./layout";
