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
