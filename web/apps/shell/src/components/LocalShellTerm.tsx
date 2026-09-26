import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArmedButton, Button } from "@kubebay/ui";
import { settingsApi, type ClusterInfo, type LocalShellCapability } from "../lib/api";
import {
  bindTo,
  bindingLooksProduction,
  classifyShellEnd,
  contextOf,
  describeExit,
  isStale,
  looksProduction,
  type ShellBinding,
  type ShellEnd,
} from "../lib/localshell";
import { useChannelTerm } from "../lib/useChannelTerm";

const KUBECTL_HINT =
  "\x1b[33m■ kubectl is not on this machine's PATH.\x1b[0m\r\n" +
  "\x1b[2mKubebay will not install it for you. See https://kubernetes.io/docs/tasks/tools/\x1b[0m\r\n\r\n";

type Phase =
  | { at: "connecting" }
  | { at: "live" }
  | { at: "ended"; end: ShellEnd }
  | { at: "lost" };

/** One PTY. Remounted (new key) to restart; unmounting ends the session. */
function ShellSession({
  cluster,
  kubectlMissing,
  onPhase,
}: {
  cluster: string;
  kubectlMissing: boolean;
  onPhase: (p: Phase) => void;
}) {
  const phaseRef = useRef<Phase["at"]>("connecting");
  const report = (p: Phase) => {
    phaseRef.current = p.at;
    onPhase(p);
  };

  const { hostRef } = useChannelTerm({
    idPrefix: "lsh",
    open: (id, geom) => ({ id, kind: "local-shell", cluster, cols: geom.cols, rows: geom.rows }),
    onSetup: (term) => {
      report({ at: "connecting" });
      if (kubectlMissing) term.write(KUBECTL_HINT);
    },
    onData: () => {
      // Fires per frame; only the first one is a state change.
      if (phaseRef.current !== "live") report({ at: "live" });
    },
    onClosed: (msg) => report({ at: "ended", end: classifyShellEnd(msg) }),
    // A default engine build answers chan-open with an error frame rather than
    // a chan-closed, so without this the terminal would sit blank forever.
    onRejected: (msg) => report({ at: "ended", end: classifyShellEnd(msg) }),
    onStatus: (connected) => {
      // lib/ws.ts replays subscriptions across a reconnect but not channels, so
      // a dropped socket really is a dead PTY. Say so; never reopen silently.
      if (!connected && phaseRef.current !== "ended") report({ at: "lost" });
    },
    deps: [cluster],
  });

  return <div ref={hostRef} className="term-host" />;
}

function Unavailable({ cap }: { cap?: LocalShellCapability }) {
  return (
    <div className="page">
      <div className="empty-state">
        <p>This engine build has no local shell.</p>
        <p className="muted small">{cap?.reason ?? "The engine reports no local-shell support."}</p>
        <p className="muted small" style={{ maxWidth: 520 }}>
          It is a build-time feature and released binaries leave it out on purpose: a shell
          reachable from the engine's HTTP listener turns a leaked session token into code
          execution on this machine. Build the engine with <code>-tags localshell</code> and start
          it with <code>--local-shell</code> on a loopback address to enable it.
        </p>
      </div>
    </div>
  );
}

export function LocalShellTerm({
  selectedCluster,
  clusters,
}: {
  selectedCluster: string;
  clusters: ClusterInfo[];
}) {
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });
  const cap = settings.data?.localShell;

  // The context this shell is pinned to. Set once at open time and only ever
  // changed by an explicit user action — it does not follow the cluster picker.
  const [bound, setBound] = useState<ShellBinding | null>(null);
  const [nonce, setNonce] = useState(0);
  const [phase, setPhase] = useState<Phase>({ at: "connecting" });
  // The cluster the user said they did not want to move to, so the stale
  // banner stops asking about that one.
  const [dismissedTarget, setDismissedTarget] = useState("");

  const selectedContext = contextOf(selectedCluster, clusters);
  const selectedIsProd = looksProduction(selectedCluster, selectedContext);

  const bind = (id: string) => {
    setBound(bindTo(id, clusters));
    setDismissedTarget("");
    setPhase({ at: "connecting" });
    setNonce((n) => n + 1);
  };

  // First open. A production-looking context is never opened without a click;
  // anything else opens as soon as the pane is first shown.
  useEffect(() => {
    if (bound || !cap?.available || !selectedCluster || selectedIsProd) return;
    setBound(bindTo(selectedCluster, clusters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bound, cap?.available, selectedCluster, selectedIsProd]);

  const ended = phase.at === "ended" ? phase.end : null;

  if (settings.isLoading) return <div className="page" />;
  if (!cap?.available) return <Unavailable cap={cap} />;
  // The capability said yes but the engine refused the channel — a restart into
  // a build without the feature. Same answer as !available, same calm screen.
  if (ended?.kind === "unsupported") return <Unavailable cap={{ ...cap, reason: ended.detail }} />;
  if (!selectedCluster) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>No cluster selected.</p>
          <p className="muted small">A local shell is opened against one kubeconfig context.</p>
        </div>
      </div>
    );
  }

  const boundIsProd = bindingLooksProduction(bound);
  const stale = isStale(bound, selectedCluster, dismissedTarget);
  const kubectlMissing = cap.kubectl ? !cap.kubectl.found : false;

  return (
    <div className="local-shell">
      {!bound && !selectedIsProd && <div className="page" />}

      {!bound && selectedIsProd && (
        <div className="page">
          <div className="empty-state">
            <p>
              Open a shell on <strong>{selectedContext}</strong>?
            </p>
            <p className="muted small" style={{ maxWidth: 520 }}>
              That context name reads like production. Kubebay only matched the name — it cannot
              tell what the cluster really is. Check it yourself before you type anything here.
            </p>
            <div style={{ marginTop: 12 }}>
              <ArmedButton
                label={`Open shell on ${selectedContext}`}
                confirmLabel="Yes — open a shell on that context"
                onGo={() => bind(selectedCluster)}
              />
            </div>
          </div>
        </div>
      )}

      {bound && (
        <>
          {boundIsProd && (
            <div className="inline-banner warn">
              <span>
                <strong>{bound.context}</strong> reads like a production context. This is a check
                on the name only: it cannot tell what the cluster really is, and a name that looks
                harmless proves nothing.
              </span>
            </div>
          )}

          <div className="inline-banner ok">
            <span>
              Bound to context <strong>{bound.context}</strong> (cluster{" "}
              <strong>{bound.cluster}</strong>). kubectl in this terminal targets that context. It
              does not follow the cluster picker.
            </span>
          </div>

          {stale && (
            <div className="inline-banner warn">
              <span>
                Kubebay now shows <strong>{selectedCluster}</strong>. This shell stays on{" "}
                <strong>{bound.context}</strong> until you say otherwise.
              </span>
              <span className="inline-banner-actions">
                <ArmedButton
                  label={`Open a shell on ${selectedContext}`}
                  confirmLabel="Confirm — ends this session and its scrollback"
                  onGo={() => bind(selectedCluster)}
                />
                <Button variant="ghost" onClick={() => setDismissedTarget(selectedCluster)}>
                  Keep this shell
                </Button>
              </span>
            </div>
          )}

          {phase.at === "ended" && phase.end.kind === "unsupported" && (
            <div className="inline-banner">
              <span>{phase.end.detail}</span>
            </div>
          )}

          {phase.at === "ended" && phase.end.kind === "exit" && (
            <div className="inline-banner warn">
              <span>Session ended — {describeExit(phase.end.code)}.</span>
              <span className="inline-banner-actions">
                <Button onClick={() => setNonce((n) => n + 1)}>Restart</Button>
              </span>
            </div>
          )}

          {phase.at === "ended" && phase.end.kind === "error" && (
            <div className="inline-banner">
              <span>Session ended — {phase.end.detail}.</span>
              <span className="inline-banner-actions">
                <Button onClick={() => setNonce((n) => n + 1)}>Restart</Button>
              </span>
            </div>
          )}

          {phase.at === "lost" && (
            <div className="inline-banner warn">
              <span>
                The engine connection dropped. Kubebay replays its watches on reconnect but not
                terminals, so this shell's process is gone.
              </span>
              <span className="inline-banner-actions">
                <Button onClick={() => setNonce((n) => n + 1)}>Restart</Button>
              </span>
            </div>
          )}

          <ShellSession
            key={`${bound.cluster}#${nonce}`}
            cluster={bound.cluster}
            kubectlMissing={kubectlMissing}
            onPhase={setPhase}
          />
        </>
      )}
    </div>
  );
}
