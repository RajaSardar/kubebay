import { useEffect, useRef, useState } from "react";
import { ArmedButton, Button, EmptyState, InlineBanner } from "@kubebay/ui";
import type { ClusterInfo } from "../lib/api";
import { typeWhenQuiet } from "../lib/extensions";
import { bindTo, contextOf, describeExit, isStale, looksProduction } from "../lib/localshell";
import { createShellSession, currentShell, setCurrentShell } from "../lib/shellSession";
import { useTerminalDock } from "../lib/terminalDock";
import type { ShellPrefill } from "../lib/useExtensions";
import { useWsStatus } from "../lib/useWsStatus";
import { xtermDeps } from "../lib/xtermTerm";

// ADR 0005: the dock's shell. Loaded the first time the dock opens on an
// engine with a local shell, so xterm stays out of the main chunk. The shell
// itself lives in shellSession, outside this component: hiding the dock only
// takes the terminal out of the page.

const KUBECTL_HINT =
  "\x1b[33m■ kubectl is not on this machine's PATH.\x1b[0m\r\n" +
  "\x1b[2mKubebay will not install it for you. See https://kubernetes.io/docs/tasks/tools/\x1b[0m\r\n\r\n";

const ENDS_SESSION = "Confirm — ends this session and its scrollback";

export default function DockShell({
  selectedCluster,
  clusters,
  kubectlMissing,
}: {
  selectedCluster: string;
  clusters: ClusterInfo[];
  kubectlMissing: boolean;
}) {
  const binding = useTerminalDock((s) => s.binding);
  const phase = useTerminalDock((s) => s.phase);
  const prefill = useTerminalDock((s) => s.prefill);
  const wantFocus = useTerminalDock((s) => s.wantFocus);
  const autoOpen = useTerminalDock((s) => s.autoOpen);
  const ws = useWsStatus();
  const host = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState("");
  const [typed, setTyped] = useState<ShellPrefill | null>(null);

  const shell = binding ? currentShell() : null;
  const live = !!shell && (phase?.at === "connecting" || phase?.at === "live");

  /** Ends any shell and opens one bound to `cluster`, typing `command` once its prompt settles. */
  const start = (cluster: string, command?: ShellPrefill) => {
    currentShell()?.end();
    const bound = bindTo(cluster, clusters);
    let typer: ReturnType<typeof typeWhenQuiet> | null = null;
    const s = createShellSession(xtermDeps, {
      cluster,
      onPhase: (p) => {
        if (currentShell() === s) useTerminalDock.getState().setShell(bound, p);
      },
      onSetup: (session) => {
        if (kubectlMissing) session.write(KUBECTL_HINT);
        if (command) {
          typer = typeWhenQuiet(command.command, (text) => {
            session.paste(text);
            setTyped(command);
          });
        }
      },
      onData: () => typer?.onData(),
    });
    setCurrentShell(s);
    setDismissed("");
    setTyped(null);
    useTerminalDock.getState().setShell(bound, { at: "connecting" });
  };

  const prefillIsProd = !!prefill && looksProduction(prefill.cluster, contextOf(prefill.cluster, clusters));
  const selectedContext = contextOf(selectedCluster, clusters);
  const selectedIsProd = looksProduction(selectedCluster, selectedContext);

  // With no shell running, a command from an extension opens one on its
  // cluster (asking first on production) and is typed once; otherwise the
  // first shell of a run opens by itself on a context that isn't production.
  useEffect(() => {
    if (live) return;
    if (prefill) {
      if (!prefillIsProd) {
        start(prefill.cluster, prefill);
        useTerminalDock.getState().clearPrefill();
      }
      return;
    }
    if (!shell && autoOpen && selectedCluster && !selectedIsProd) start(selectedCluster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, prefill, shell, selectedCluster, autoOpen]);

  // Show the shell here while the dock is open; take it out when it closes.
  useEffect(() => {
    if (!shell || !host.current) return;
    shell.attach(host.current);
    return () => shell.detach();
  }, [shell]);

  // Focus only when asked (Ctrl+`, the sidebar, the status bar).
  useEffect(() => {
    if (!wantFocus || !shell) return;
    shell.focus();
    useTerminalDock.getState().focusDone();
  }, [wantFocus, shell]);

  const stale = isStale(binding, selectedCluster, dismissed);
  const restart = () => {
    setTyped(null);
    shell?.restart();
  };
  const restartButton =
    binding && looksProduction(binding.cluster, binding.context) ? (
      <ArmedButton label="Restart" confirmLabel={`Confirm — opens a new shell on ${binding.context}`} busy={!ws.connected} onGo={restart} />
    ) : (
      <Button disabled={!ws.connected} onClick={restart}>
        Restart
      </Button>
    );

  const openOn = (cluster: string, command?: ShellPrefill) => {
    const ctx = contextOf(cluster, clusters);
    return looksProduction(cluster, ctx) ? (
      <ArmedButton label={`Open shell on ${ctx}`} confirmLabel="Yes — open a shell on that context" onGo={() => start(cluster, command)} />
    ) : (
      <Button onClick={() => start(cluster, command)}>Open a shell on {ctx}</Button>
    );
  };

  return (
    <div className="kb-dock-shell">
      {!shell && !prefill && (
        <EmptyState>
          {selectedCluster ? (
            <>
              {selectedIsProd && (
                <p className="muted small" style={{ maxWidth: 520 }}>
                  <strong>{selectedContext}</strong> reads like production. Kubebay only matched the name — it cannot
                  tell what the cluster really is. Check it yourself before you type anything here.
                </p>
              )}
              {openOn(selectedCluster)}
            </>
          ) : (
            <p className="muted small">Pick a cluster to open a shell on its context.</p>
          )}
        </EmptyState>
      )}

      {stale && (
        <InlineBanner tone="warn" flush>
          <span>
            Kubebay now shows <strong>{selectedCluster}</strong>. This shell stays on <strong>{binding!.context}</strong>{" "}
            until you say otherwise.
          </span>
          <span className="inline-banner-actions">
            <ArmedButton label={`Open a shell on ${selectedContext}`} confirmLabel={ENDS_SESSION} onGo={() => start(selectedCluster)} />
            <Button variant="ghost" onClick={() => setDismissed(selectedCluster)}>
              Keep this shell
            </Button>
          </span>
        </InlineBanner>
      )}

      {prefill && (live || prefillIsProd) && (
        <InlineBanner tone="warn" flush>
          <span>
            From your extension <strong>{prefill.label}</strong>
            {live ? ": Kubebay won't type it into a running shell. " : ". "}
            <code>{prefill.command}</code>
          </span>
          <span className="inline-banner-actions">
            <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(prefill.command)}>
              Copy
            </Button>
            {live && shell && prefill.cluster === shell.cluster ? (
              <Button
                onClick={() => {
                  shell.paste(prefill.command);
                  setTyped(prefill);
                  useTerminalDock.getState().clearPrefill();
                }}
              >
                Type into this shell
              </Button>
            ) : live ? (
              <ArmedButton
                label={`Open a shell on ${contextOf(prefill.cluster, clusters)}`}
                confirmLabel={ENDS_SESSION}
                onGo={() => {
                  start(prefill.cluster, prefill);
                  useTerminalDock.getState().clearPrefill();
                }}
              />
            ) : (
              openOn(prefill.cluster, prefill)
            )}
          </span>
        </InlineBanner>
      )}

      {typed && (
        <InlineBanner tone="warn" flush>
          <span>
            Typed from your extension <strong>{typed.label}</strong>. Read it, then press Enter to run it, or clear the
            line. <code>{typed.command}</code>
          </span>
        </InlineBanner>
      )}

      {shell && phase?.at === "ended" && phase.end.kind !== "unsupported" && (
        <InlineBanner tone={phase.end.kind === "exit" ? "warn" : undefined} flush>
          <span>
            Session ended — {phase.end.kind === "exit" ? describeExit(phase.end.code) : phase.end.detail}.
          </span>
          <span className="inline-banner-actions">{restartButton}</span>
        </InlineBanner>
      )}

      {shell && phase?.at === "ended" && phase.end.kind === "unsupported" && (
        <InlineBanner flush>
          <span>{phase.end.detail}</span>
        </InlineBanner>
      )}

      {shell && phase?.at === "lost" && (
        <InlineBanner tone="warn" flush>
          <span>
            The engine connection dropped. Kubebay replays its watches on reconnect but not terminals, so this
            shell&apos;s process is gone.
          </span>
          <span className="inline-banner-actions">{restartButton}</span>
        </InlineBanner>
      )}

      <div ref={host} className="kb-dock-term" hidden={!shell} />
    </div>
  );
}
