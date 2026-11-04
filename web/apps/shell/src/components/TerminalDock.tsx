import { lazy, Suspense, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Splitter, StatusPill, VisuallyHidden } from "@kubebay/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { PageHelp } from "./PageHelp";
import { settingsApi, type ClusterInfo, type LocalShellCapability } from "../lib/api";
import { bindingLooksProduction } from "../lib/localshell";
import { currentShell, setCurrentShell } from "../lib/shellSession";
import { dockBounds, useTerminalDock } from "../lib/terminalDock";

// ADR 0005: the terminal lives in a dock under the page. This part loads with
// the app and holds no terminal: the shell itself (xterm) is in DockShell,
// loaded the first time the dock opens on an engine that has a local shell.

const DockShell = lazy(() => import("./DockShell"));

function Unavailable({ cap }: { cap?: LocalShellCapability }) {
  return (
    <EmptyState>
      <p>This engine build has no local shell.</p>
      <p className="muted small">{cap?.reason ?? "The engine reports no local-shell support."}</p>
      <p className="muted small" style={{ maxWidth: 520 }}>
        It is a build-time feature and released binaries leave it out on purpose: a shell reachable from the
        engine&apos;s HTTP listener turns a leaked session token into code execution on this machine. Build the
        engine with <code>-tags localshell</code> and start it with <code>--local-shell</code> on a loopback address
        to enable it.
      </p>
    </EmptyState>
  );
}

/** Ends the dock's shell, if there is one. Nothing opens until asked. */
export function endDockShell() {
  currentShell()?.end();
  setCurrentShell(null);
  useTerminalDock.getState().shellEnded();
}

export function TerminalDock({
  selectedCluster,
  clusters,
  dockRef,
}: {
  /** The cluster the app shows: a new shell binds to it, and the dock offers it when it differs. */
  selectedCluster: string;
  clusters: ClusterInfo[];
  /** The dock's element, so drawers can end above it and ignore presses in it. */
  dockRef?: Ref<HTMLElement>;
}) {
  const open = useTerminalDock((s) => s.open);
  const height = useTerminalDock((s) => s.height);
  const setHeight = useTerminalDock((s) => s.setHeight);
  const closeDock = useTerminalDock((s) => s.closeDock);
  const binding = useTerminalDock((s) => s.binding);
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

  if (!open) return null;

  const cap = settings.data?.localShell;
  const bounds = dockBounds(window.innerHeight);
  const shown = Math.min(height, bounds.max);
  const prod = bindingLooksProduction(binding);

  return (
    <section ref={dockRef} className="kb-dock" aria-label="Terminal" style={{ height: shown }}>
      <Splitter
        label="Resize the terminal"
        value={shown}
        min={bounds.min}
        max={bounds.max}
        defaultValue={bounds.initial}
        onChange={setHeight}
      />
      <div className="kb-dock-head">
        <span className="kb-dock-title">
          Terminal
          {binding && (
            <>
              {" · "}
              <span className="mono">{binding.context}</span>
            </>
          )}
        </span>
        {binding && prod && (
          <span title="The context's name reads like production. A name check only: Kubebay can't tell what the cluster really is.">
            <StatusPill tone="err">production</StatusPill>
            <VisuallyHidden> (name check only)</VisuallyHidden>
          </span>
        )}
        <span className="kb-dock-actions">
          {binding && (
            <Button variant="ghost" onClick={endDockShell}>
              End shell
            </Button>
          )}
          <Button variant="ghost" onClick={closeDock}>
            Hide
          </Button>
          <PageHelp route="/terminal" align="end" />
        </span>
      </div>
      <div className="kb-dock-body">
        {settings.isLoading ? null : !cap?.available ? (
          <Unavailable cap={cap} />
        ) : (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <DockShell selectedCluster={selectedCluster} clusters={clusters} kubectlMissing={cap.kubectl ? !cap.kubectl.found : false} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
    </section>
  );
}
