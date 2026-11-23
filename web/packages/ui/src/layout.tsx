import { forwardRef, type ElementType, type HTMLAttributes } from "react";

/** A step on the spacing scale: 0, or --kb-space-1…6 (4, 8, 12, 16, 24, 32px). */
export type Gap = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FlexProps extends HTMLAttributes<HTMLElement> {
  gap?: Gap;
  /** Cross-axis alignment (align-items). CSS default (stretch) when omitted. */
  align?: "start" | "center" | "end" | "baseline" | "stretch";
  /** Main-axis distribution (justify-content). */
  justify?: "start" | "center" | "end" | "between";
  /** Let children flow onto more lines. */
  wrap?: boolean;
  /** The element to render; a div by default. */
  as?: ElementType;
}

function flex(base: string, { gap, align, justify, wrap, as: As = "div", className, ...rest }: FlexProps, ref: unknown) {
  const cls = [
    base,
    gap != null && `kb-gap-${gap}`,
    align && `kb-align-${align}`,
    justify && `kb-justify-${justify}`,
    wrap && "kb-wrap",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <As ref={ref} className={cls} {...rest} />;
}

/** Children side by side. Spacing comes from `gap`, not margins on the children. */
export const Row = forwardRef<HTMLElement, FlexProps>(function Row(props, ref) {
  return flex("kb-row", props, ref);
});

/** Children one above the other. */
export const Stack = forwardRef<HTMLElement, FlexProps>(function Stack(props, ref) {
  return flex("kb-stack", props, ref);
});

export interface GridProps extends Omit<FlexProps, "align" | "justify" | "wrap"> {
  /** The narrowest a column gets, in px; as many columns fit as the width allows. */
  min?: number;
}

/**
 * Cards in columns. The gap (spacing scale, 8px by default) is the only
 * separator: cards are blocks and carry no margins of their own.
 */
export const Grid = forwardRef<HTMLElement, GridProps>(function Grid({ min = 300, gap = 2, style, ...rest }, ref) {
  return flex("kb-grid", { gap, style: { gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, ...style }, ...rest }, ref);
});

/** Pins its children to the window's bottom-right corner, above the page. */
export function Corner({ children }: { children: React.ReactNode }) {
  return <div className="kb-corner">{children}</div>;
}

export interface PropertyListProps extends HTMLAttributes<HTMLDListElement> {
  /** Set every label and value in monospace (annotations, labels). */
  mono?: boolean;
}

/**
 * Label/value rows, such as a drawer's Metadata: a description list, so a
 * screen reader announces each label with its value. Two columns, a hairline
 * between rows. Children are `Property`s.
 */
export function PropertyList({ mono, className, ...rest }: PropertyListProps) {
  const cls = ["kb-props", mono && "mono", className].filter(Boolean).join(" ");
  return <dl className={cls} {...rest} />;
}

export interface PropertyProps {
  label: React.ReactNode;
  /** The value. Nothing, null or "" leaves the row out; 0 is shown. */
  children?: React.ReactNode;
  /** Set the value in monospace. */
  mono?: boolean;
}

/** One row of a `PropertyList`. */
export function Property({ label, children, mono }: PropertyProps) {
  if (children === null || children === undefined || children === "" || children === false) return null;
  return (
    <div className="kb-prop">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{children}</dd>
    </div>
  );
}
