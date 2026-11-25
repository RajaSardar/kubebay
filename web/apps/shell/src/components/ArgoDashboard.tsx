import { useEffect, useRef, useState } from "react";
import { Button, EmptyState, InlineBanner } from "@kubebay/ui";
import { PageLoader } from "./PageLoader";
import { CopyableCommand } from "./CopyableCommand";
import { DASHBOARD_FRAME_SANDBOX, HEARTBEAT_MS, effectiveNamespace, rolloutsDashApi, type DashStatus } from "../lib/rolloutsDash";

interface Props {
  cluster: string;
  /** The namespaces selected in the filter; exactly one is passed on to the tool. */
  namespaces?: string[];
  /** Back to Kubebay's own Rollouts view (the plugin is missing or failed). */
  onUseReleaseView: () => void;
}

/**
 * Argo's own dashboard, run for this cluster by the engine and shown in a
 * frame (backlog 87). It starts when this component mounts, is kept alive by a
 * heartbeat while it is open, and is released when it unmounts; the engine
 * stops it a minute later unless this tab comes back.
 */
export function ArgoDashboard({ cluster, namespaces, onUseReleaseView }: Props) {
  const [status, setStatus] = useState<DashStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const runningRef = useRef(false);
  const nsKey = (namespaces ?? []).join(",");

  useEffect(() => {
    let dead = false;
    setStatus(null);
    runningRef.current = false;
    const failed = (e: unknown): DashStatus => ({ state: "failed", message: e instanceof Error ? e.message : String(e) });
    async function open() {
      try {
        let s = await rolloutsDashApi.status(cluster);
        // A running dashboard is reused only for the namespace it was started with.
        if (s.state === "stopped" || (s.state === "running" && (s.namespace ?? "") !== effectiveNamespace(namespaces))) {
          if (!dead) setStatus({ state: "starting" });
          s = await rolloutsDashApi.start(cluster, namespaces);
        }
        if (!dead) {
          runningRef.current = s.state === "running";
          setStatus(s);
        }
      } catch (e) {
        if (!dead) setStatus(failed(e));
      }
    }
    void open();
    const beat = setInterval(() => {
      rolloutsDashApi
        .heartbeat(cluster)
        .then((alive) => {
          // The engine restarted or stopped a dashboard that was running (a throttled webview): start again, quietly. A failure on screen is left for the user to retry.
          if (!alive && !dead && runningRef.current) setAttempt((n) => n + 1);
        })
        .catch(() => {});
    }, HEARTBEAT_MS);
    return () => {
      dead = true;
      clearInterval(beat);
      void rolloutsDashApi.release(cluster).catch(() => {});
    };
    // namespaces is read through nsKey so a new array with the same names does not restart it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cluster, nsKey, attempt]);

  if (!status || status.state === "starting") return <PageLoader message="Starting the Argo dashboard…" />;

  if (status.state === "not-installed") {
    const help = status.install;
    return (
      <EmptyState>
        <p>kubectl-argo-rollouts is not installed on this computer.</p>
        <p className="muted small">
          Kubebay runs Argo's own dashboard from the plugin you install yourself; it never downloads anything. Install it with one of these, then open this tab again.
        </p>
        {help?.commands.map((c) => (
          <CopyableCommand key={c} command={c} label="Install command" />
        ))}
        {help && (
          <p className="small">
            <a href={help.releasesUrl} target="_blank" rel="noreferrer noopener">
              Argo Rollouts releases
            </a>
          </p>
        )}
        <p className="muted small">Meanwhile the Rollouts view shows the same release in Kubebay.</p>
        <Button onClick={onUseReleaseView}>Use the Rollouts view</Button>
      </EmptyState>
    );
  }

  if (status.state === "failed" || status.state === "unavailable" || status.state === "stopped" || !status.url) {
    return (
      <div className="page-body">
        <InlineBanner flush>
          <span className="small">{status.message || status.reason || "The Argo dashboard could not be started."}</span>
          {status.stderrTail && <pre className="mono small">{status.stderrTail}</pre>}
          <div>
            <Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>{" "}
            <Button onClick={onUseReleaseView}>Use the Rollouts view</Button>
          </div>
        </InlineBanner>
      </div>
    );
  }

  return <iframe className="argo-frame" title="Argo Rollouts dashboard" src={status.url} sandbox={DASHBOARD_FRAME_SANDBOX} referrerPolicy="no-referrer" />;
}
