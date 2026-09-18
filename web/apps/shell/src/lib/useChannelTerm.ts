import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { attach, chanSend, closeChannel, openChannel, resizeChannel, type ChanSpec } from "./ws";

/** What a terminal's callbacks can do to their own terminal. */
export interface TermHandle {
  write(data: string | Uint8Array): void;
  /** The channel currently open, or "" between sessions. */
  readonly channelId: string;
  /** Close the open channel, if any, and open a fresh one through `open`. */
  reopen(): void;
}

export interface ChannelTermOptions {
  /** Builds the chan-open frame. The hook owns the channel id. */
  open(id: string, geom: { cols: number; rows: number }): ChanSpec;
  /** Short tag in generated channel ids, so they are legible in engine logs. */
  idPrefix: string;
  /** Runs once per terminal, before the first channel is opened. */
  onSetup?(term: TermHandle): void;
  /** Data has already been written to the terminal; this is a notification. */
  onData?(data: Uint8Array, term: TermHandle): void;
  onClosed?(message: string | undefined, term: TermHandle): void;
  /**
   * The engine refused the chan-open outright — a kind it does not know, or a
   * duplicate id. No chan-closed follows one of these, so a caller that ignores
   * it is left staring at a terminal that will never say anything.
   */
  onRejected?(message: string, term: TermHandle): void;
  onStatus?(connected: boolean, term: TermHandle): void;
  /** Changing any of these disposes the terminal and builds a new one. */
  deps: readonly unknown[];
}

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

function readTermTheme(): ITheme {
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

function readTermFont() {
  const root = getComputedStyle(document.documentElement);
  const family = root.getPropertyValue("--kb-font-mono").trim();
  const size = parseFloat(root.getPropertyValue("--kb-text-sm"));
  return {
    fontFamily: family || "ui-monospace, monospace",
    fontSize: Number.isFinite(size) && size > 0 ? size : 12,
  };
}

/**
 * An xterm terminal wired to one chan-* channel: font and colours from the
 * app theme, stdin to chanSend, a ResizeObserver to chan-resize, and teardown
 * of both on unmount.
 *
 * Session policy — which channel to open, what a close message means, whether
 * to reopen — stays with the caller; this hook only owns the plumbing.
 */
export function useChannelTerm(opts: ChannelTermOptions) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Callbacks are re-created every render but must not tear the PTY down, so
  // the effect reads them through a ref instead of depending on them.
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const reopenRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      ...readTermFont(),
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: readTermTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        // A hidden or zero-height host has no dimensions to fit to; the
        // ResizeObserver fires again once it does.
      }
    };
    safeFit();

    const geometry = () => {
      try {
        const dm = fit.proposeDimensions();
        if (dm && dm.cols > 2 && dm.rows > 2) return { cols: dm.cols, rows: dm.rows };
      } catch {
        /* fall through to the default geometry */
      }
      return { cols: 80, rows: 24 };
    };

    let channelId = "";
    const handle: TermHandle = {
      write: (data) => term.write(data),
      get channelId() {
        return channelId;
      },
      reopen: () => doOpen(),
    };

    function doOpen() {
      if (channelId) closeChannel(channelId);
      channelId = `${optsRef.current.idPrefix}-${Math.random().toString(36).slice(2, 10)}`;
      openChannel(optsRef.current.open(channelId, geometry()));
    }

    // Attached before the first open so no frame for this channel can arrive
    // while there is nothing listening for it.
    const detach = attach({
      onChanData: (id, data) => {
        if (id !== channelId) return;
        term.write(data);
        optsRef.current.onData?.(data, handle);
      },
      onChanClosed: (id, message) => {
        if (id === channelId) optsRef.current.onClosed?.(message, handle);
      },
      onError: (id, message) => {
        if (id === channelId) optsRef.current.onRejected?.(message, handle);
      },
      onStatus: (connected) => optsRef.current.onStatus?.(connected, handle),
    });

    optsRef.current.onSetup?.(handle);
    reopenRef.current = () => doOpen();
    doOpen();

    term.onData((d) => {
      if (channelId) chanSend(channelId, new TextEncoder().encode(d));
    });

    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTermTheme();
      Object.assign(term.options, readTermFont());
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const ro = new ResizeObserver(() => {
      safeFit();
      const { cols, rows } = geometry();
      if (channelId) resizeChannel(channelId, cols, rows);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      themeObserver.disconnect();
      if (channelId) closeChannel(channelId);
      channelId = "";
      reopenRef.current = () => {};
      detach();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps);

  /** Ends the current session and starts a new one on the same terminal. */
  const restart = () => reopenRef.current();

  return { hostRef, restart };
}
