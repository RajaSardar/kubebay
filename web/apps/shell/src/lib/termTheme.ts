import type { ITheme } from "@xterm/xterm";

// A terminal's font and colours, read from the app's --kb-* tokens so every
// theme applies. Type-only import: this module loads no xterm.

// Only the colours the token set actually defines. black/white/magenta and the
// bright variants are left at xterm's defaults rather than invented here: the
// palette has no token for them, and mapping ANSI black onto a light theme's
// background would render `\x1b[30m` text invisible.
const TERM_COLOR_TOKENS: Record<string, string> = {
  background: "--kb-bg-inset",
  foreground: "--kb-fg-default",
  cursor: "--kb-accent",
  cursorAccent: "--kb-bg-inset",
  selectionBackground: "--kb-selection",
  red: "--kb-status-err",
  green: "--kb-status-ok",
  yellow: "--kb-status-warn",
  blue: "--kb-accent",
  cyan: "--kb-status-info",
};

// xterm parses #rgb/#rrggbb/rgb()/rgba() directly and falls back to a canvas
// probe for anything else, which throws on a translucent result. Skipping a
// value we cannot vouch for leaves xterm's default in place instead.
const XTERM_PARSEABLE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;

export function readTermTheme(): ITheme {
  // getComputedStyle().getPropertyValue() on a custom property returns the
  // token's *declared* text — var() chains and color-mix() come back
  // unresolved. Assigning it to a real `color` declaration and reading that
  // back makes the browser compute it down to rgb()/rgba().
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const theme: Record<string, string> = {};
  try {
    for (const [key, token] of Object.entries(TERM_COLOR_TOKENS)) {
      probe.style.color = "";
      probe.style.color = `var(${token})`;
      const value = getComputedStyle(probe).color.trim();
      if (XTERM_PARSEABLE.test(value)) theme[key] = value;
    }
  } finally {
    probe.remove();
  }
  return theme as ITheme;
}

export function readTermFont() {
  const root = getComputedStyle(document.documentElement);
  const family = root.getPropertyValue("--kb-font-mono").trim();
  const size = parseFloat(root.getPropertyValue("--kb-text-sm"));
  return {
    fontFamily: family || "ui-monospace, monospace",
    fontSize: Number.isFinite(size) && size > 0 ? size : 12,
  };
}
