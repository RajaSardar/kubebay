import { useId } from "react";

// The mark's two gradient stops are the brand colours (site-accent cyan → site-accent-2 green).
// They are the only literal colours outside tokens.css: the mark is never re-tinted per theme.
const BRAND_CYAN = "#22d3ee";
const BRAND_GREEN = "#41c98e";

/**
 * The Kubebay mark: a cyan→green squircle with the white helm-and-harbour glyph.
 * Below 40px it uses the 32-unit drawing (2px strokes); at 40px and up the heavier 48-unit one.
 */
export function KubebayMark({ size = 28, className }: { size?: number; className?: string }) {
  const id = `kb-mark-${useId().replace(/:/g, "")}`;
  const large = size >= 40;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={large ? "0 0 48 48" : "0 0 32 32"}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={BRAND_CYAN} />
          <stop offset="100%" stopColor={BRAND_GREEN} />
        </linearGradient>
      </defs>
      {large ? (
        <>
          <rect width="48" height="48" rx="13" fill={`url(#${id})`} />
          <circle cx="24" cy="21" r="8" fill="none" stroke="#fff" strokeWidth="2.5" />
          <path d="M11 34c4 3.4 8.2 5 13 5s9-1.6 13-5" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
          <path d="M24 13v16M16 20h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity=".85" />
        </>
      ) : (
        <>
          <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
          <circle cx="16" cy="14.5" r="5.4" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M7.5 22.5c2.6 2.3 5.4 3.4 8.5 3.4s5.9-1.1 8.5-3.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 9v11M10 13.5h12" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        </>
      )}
    </svg>
  );
}
