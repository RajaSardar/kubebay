import { useRef } from "react";
import { useChannelTerm } from "../lib/useChannelTerm";

const SHELL_CANDIDATES: Record<string, string[][]> = {
  auto: [["bash", "-l"], ["sh"], ["ash"]],
  bash: [["bash", "-l"]],
  sh: [["sh"]],
  ash: [["ash"]],
  powershell: [["powershell"]],
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
  const candidates = SHELL_CANDIDATES[shell] ?? SHELL_CANDIDATES.auto!;
  // Which shell we are trying, and whether it ever spoke. Both are per-terminal
  // state, reset in onSetup rather than on render so a reopen starts the ladder
  // from the top again.
  const candIdx = useRef(0);
  const gotOutput = useRef(false);

  const { hostRef } = useChannelTerm({
    idPrefix: "exec",
    open: (id, geom) => ({
      id,
      kind: "exec",
      cluster,
      namespace,
      pod,
      container,
      command: candidates[candIdx.current]!,
      cols: geom.cols,
      rows: geom.rows,
    }),
    onSetup: () => {
      candIdx.current = 0;
      gotOutput.current = false;
    },
    onData: () => {
      gotOutput.current = true;
    },
    onClosed: (msg, term) => {
      const failed =
        !!msg && msg !== "done" && /not found|no such file|executable|OCI runtime/i.test(msg);
      if (failed && candIdx.current < candidates.length - 1 && !gotOutput.current) {
        const triedShell = candidates[candIdx.current]![0];
        candIdx.current += 1;
        const next = candidates[candIdx.current]!;
        term.write(
          `\r\n\x1b[2m[${triedShell} not available — falling back to ${next[0]}…]\x1b[0m\r\n`,
        );
        term.reopen();
        return;
      }
      if (failed && !gotOutput.current) {
        term.write(
          "\r\n\x1b[31m■ This container ships no shell (distroless image?).\x1b[0m\r\n" +
            "\x1b[2mTip: use the Logs tab, or run a debug pod via Node shell.\x1b[0m\r\n",
        );
        return;
      }
      let exitNote = "";
      const m = /exit code (\d+)/.exec(msg ?? "");
      if (m) {
        const code = Number(m[1]);
        exitNote = code >= 128 ? ` — terminated by signal ${code - 128}` : ` — exit ${code}`;
      }
      term.write(
        `\r\n\x1b[33m■ session ended${exitNote || (msg && msg !== "done" ? ` — ${msg}` : "")}\x1b[0m\r\n` +
          "\x1b[2mSwitch tabs and back to reopen the session.\x1b[0m\r\n",
      );
    },
    onStatus: (up, term) => {
      if (!up && term.channelId) term.write("\r\n\x1b[31m■ engine offline\x1b[0m\r\n");
    },
    deps: [cluster, namespace, pod, container, shell],
  });

  return <div ref={hostRef} className="term-host" />;
}
