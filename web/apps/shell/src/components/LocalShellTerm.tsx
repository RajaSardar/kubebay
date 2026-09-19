import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { attach, chanSend, closeChannel, openChannel, resizeChannel } from "../lib/ws";

/**
 * A context-window terminal — opens a PTY on the machine running the engine
 * with KUBECONFIG pointing at the chosen cluster. This is NOT a pod exec:
 * the user gets their own shell (bash/zsh) with kubectl pre-configured.
 *
 * Requires the engine binary to be built with -tags localshell and started
 * with --local-shell.
 */
export function LocalShellTerm({ cluster }: { cluster: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chanRef = useRef("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !cluster) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", "Cascadia Code", Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#0c0e14",
        foreground: "#e9ebf2",
        cursor: "#5b8def",
        selectionBackground: "#5b8def44",
        black: "#0c0e14",
        red: "#ef5f68",
        green: "#41c98e",
        yellow: "#dca154",
        blue: "#5b8def",
        magenta: "#c586e8",
        cyan: "#4fc4cf",
        white: "#e9ebf2",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try { fit.fit(); } catch {}

    chanRef.current = `shell-${Math.random().toString(36).slice(2, 10)}`;

    let cols = 80, rows = 24;
    try {
      const dm = fit.proposeDimensions();
      if (dm && dm.cols > 2 && dm.rows > 2) { cols = dm.cols; rows = dm.rows; }
    } catch {}

    openChannel({
      id: chanRef.current,
      kind: "local-shell",
      cluster,
      cols,
      rows,
    });

    const detach = attach({
      onChanData: (id, data) => {
        if (id === chanRef.current) term.write(data);
      },
      onChanClosed: (id, msg) => {
        if (id !== chanRef.current) return;
        const note = msg && msg !== "done" ? ` — ${msg}` : "";
        term.write(
          `\r\n\x1b[33m■ shell closed${note}\x1b[0m\r\n` +
          "\x1b[2mSwitch tabs and back to reopen.\x1b[0m\r\n",
        );
      },
      onStatus: (up) => {
        if (!up) term.write("\r\n\x1b[31m■ engine offline\x1b[0m\r\n");
      },
    });

    term.onData((d) => {
      if (chanRef.current) chanSend(chanRef.current, new TextEncoder().encode(d));
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const dm = fit.proposeDimensions();
        if (dm && dm.cols > 2 && dm.rows > 2 && chanRef.current)
          resizeChannel(chanRef.current, dm.cols, dm.rows);
      } catch {}
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      closeChannel(chanRef.current);
      chanRef.current = "";
      detach();
      term.dispose();
    };
  }, [cluster]);

  return <div ref={hostRef} className="term-host" style={{ height: "100%", width: "100%" }} />;
}
