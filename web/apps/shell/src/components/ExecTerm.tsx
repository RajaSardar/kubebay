import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { attach, chanSend, closeChannel, openChannel, resizeChannel } from "../lib/ws";

const SHELL_CANDIDATES: Record<string, string[][]> = {
  auto: [["bash", "-l"], ["sh"], ["ash"]],
  bash: [["bash", "-l"]],
  sh: [["sh"]],
  ash: [["ash"]],
  powershell: ["powershell"].map((c) => [c]),
};

export function ExecTerm({
  cluster,
  namespace,
  pod,
  container,
  shell = "auto",
}: {
  cluster: string;
  namespace: string;
  pod: string;
  container?: string;
  shell?: "auto" | "bash" | "sh" | "ash" | "powershell";
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chanRef = useRef("");

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

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
    try {
      fit.fit();
    } catch {}

    const detach = attach({
      onChanData: (id, data) => {
        if (id === chanRef.current) {
          gotOutput = true;
          term.write(data);
        }
      },
      onChanClosed: (id, msg) => {
        if (id !== chanRef.current) return;
        const failed =
          !!msg &&
          msg !== "done" &&
          /not found|no such file|executable|OCI runtime/i.test(msg);
        if (failed && candIdx < candidates.length - 1 && !gotOutput) {
          candIdx += 1;
          const next = candidates[candIdx]!;
          term.write(`\r\n\x1b[2m[${next[0]} not available — retrying with fallback…]\x1b[0m\r\n`);
          openWith(next);
          return;
        }
        term.write(`\r\n\x1b[33m■ session ended${msg && msg !== "done" ? ` — ${msg}` : ""}\x1b[0m\r\n`);
      },
      onStatus: (up) => {
        if (!up && chanRef.current) term.write("\r\n\x1b[31m■ engine offline\x1b[0m\r\n");
      },
    });

    const dims = (() => {
      try {
        return fit.proposeDimensions();
      } catch {
        return undefined;
      }
    })();

    const candidates = SHELL_CANDIDATES[shell] ?? SHELL_CANDIDATES.auto!;
    let candIdx = 0;
    let gotOutput = false;

    const openWith = (cmd: string[]) => {
      chanRef.current = `exec-${Math.random().toString(36).slice(2, 10)}`;
      openChannel({
        id: chanRef.current,
        kind: "exec",
        cluster,
        namespace,
        pod,
        container,
        command: cmd,
        cols: dims?.cols ?? 80,
        rows: dims?.rows ?? 24,
      });
    };
    openWith(candidates[0]!);

    const detachFallback = attach({
      onChanData: (id) => {
        if (id === chanRef.current) gotOutput = true;
      },
      onAck: () => {},
    });

    term.onData((d) => {
      if (chanRef.current) chanSend(chanRef.current, new TextEncoder().encode(d));
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const dm = fit.proposeDimensions();
        if (dm && chanRef.current) resizeChannel(chanRef.current, dm.cols, dm.rows);
      } catch {}
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      closeChannel(chanRef.current);
      chanRef.current = "";
      detach();
      detachFallback();
      term.dispose();
    };
  }, [cluster, namespace, pod, container]);

  return <div ref={hostRef} className="term-host" />;
}
