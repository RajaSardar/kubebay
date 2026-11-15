import { IconLoader } from "./icons";

export interface SpinnerProps {
  /** What is loading, for screen readers. `null` when the text beside it already says so. */
  label?: string | null;
  /** Diameter in px. Default 16. */
  size?: number;
  className?: string;
}

/** The loading indicator: the helm icon turning. Use it wherever a wait has no shape to sketch; lists and tables take skeleton rows instead. */
export function Spinner({ label = "Loading…", size = 16, className }: SpinnerProps) {
  const cls = `kb-spinner${className ? " " + className : ""}`;
  if (label === null) {
    return (
      <span className={cls} aria-hidden="true">
        <IconLoader size={size} />
      </span>
    );
  }
  return (
    <span className={cls} role="status" aria-busy="true" aria-label={label}>
      <IconLoader size={size} />
    </span>
  );
}
