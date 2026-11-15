import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { readTermFont, readTermTheme } from "./termTheme";
import { isShellReservedKey } from "./terminalDock";
import type { SessionDeps, TermLike } from "./shellSession";
import { attach, chanSend, closeChannel, openChannel, resizeChannel } from "./ws";

// ADR 0005: the real terminal behind the dock's session. Only the dock's lazy
// chunk imports this, so xterm stays out of the main bundle.

/** An xterm in its own element: themed from the app's tokens, opened the first time it's shown. */
export function makeXtermTerm(): TermLike {
  const element = document.createElement("div");
  element.className = "term-host";
  const term = new Terminal({
    ...readTermFont(),
    lineHeight: 1.25,
    cursorBlink: true,
    allowProposedApi: true,
    theme: readTermTheme(),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  // Returning false keeps a key out of the shell; it still bubbles to the app,
  // which toggles the dock or leaves the drawer chord alone (they skip typing).
  term.attachCustomKeyEventHandler((e) => !isShellReservedKey(e));

  const themeObserver = new MutationObserver(() => {
    term.options.theme = readTermTheme();
    Object.assign(term.options, readTermFont());
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  // xterm opens once, into an element in the page; after that, showing the
  // session elsewhere moves this element.
  let opened = false;

  return {
    element,
    write: (data) => term.write(data),
    paste: (text) => term.paste(text),
    focus: () => term.focus(),
    fit() {
      if (!opened) {
        if (!element.isConnected) return;
        term.open(element);
        opened = true;
      }
      try {
        fit.fit();
      } catch {
        // No dimensions to fit to; the next resize brings them.
      }
    },
    propose() {
      try {
        const dm = fit.proposeDimensions();
        return dm && dm.cols && dm.rows ? { cols: dm.cols, rows: dm.rows } : null;
      } catch {
        return null;
      }
    },
    onData: (cb) => {
      term.onData(cb);
    },
    dispose() {
      themeObserver.disconnect();
      term.dispose();
    },
  };
}

/** What a session needs in the app: xterm, a ResizeObserver and the engine's socket. */
export const xtermDeps: SessionDeps = {
  makeTerm: makeXtermTerm,
  observeSize(host, cb) {
    const ro = new ResizeObserver(cb);
    ro.observe(host);
    return () => ro.disconnect();
  },
  ws: { attach, openChannel, closeChannel, resizeChannel, chanSend },
};
