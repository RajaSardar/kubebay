import { lazy, Suspense, useState, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Splitter, StatusPill, Tabs, VisuallyHidden } from "@kubebay/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { PageHelp } from "./PageHelp";
import { DiscardChangesModal } from "./DiscardGuard";
import { YamlTab } from "./heavy";
import { isEditDirty } from "../lib/editGuard";
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
  const tabs = useTerminalDock((s) => s.tabs);
  const activeTab = useTerminalDock((s) => s.activeTab);
  const focusTab = useTerminalDock((s) => s.focusTab);
  const closeEditTab = useTerminalDock((s) => s.closeEditTab);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

  // Hiding the dock is not closing a tab: with YAML tabs open the section stays
  // mounted (hidden), so an edit survives Hide and Ctrl+`.
  if (!open && tabs.length === 0) return null;

  const cap = settings.data?.localShell;
  const bounds = dockBounds(window.innerHeight);
  const shown = Math.min(height, bounds.max);
  const prod = bindingLooksProduction(binding);
  const onYaml = tabs.some((t) => t.key === activeTab);
  const showShell = open && !onYaml;
  const tabIds = ["shell", ...tabs.map((t) => t.key)];
  const labels: Record<string, string> = { shell: "Shell", ...Object.fromEntries(tabs.map((t) => [t.key, `YAML ${t.name}`])) };
  const closeActive = () => {
    if (isEditDirty(activeTab)) setConfirmClose(activeTab);
    else closeEditTab(activeTab);
  };

  return (
    <section ref={dockRef} className="kb-dock" aria-label="Terminal" style={{ height: shown, display: open ? undefined : "none" }}>
      <Splitter
        label="Resize the terminal"
        value={shown}
        min={bounds.min}
        max={bounds.max}
        defaultValue={bounds.initial}
        onChange={setHeight}
      />
      {tabs.length > 0 && <Tabs tabs={tabIds} active={activeTab} labels={labels} onChange={focusTab} />}
      <div className="kb-dock-head">
        <span className="kb-dock-title">
          {onYaml ? labels[activeTab] : "Terminal"}
          {!onYaml && binding && (
            <>
              {" · "}
              <span className="mono">{binding.context}</span>
            </>
          )}
        </span>
        {!onYaml && binding && prod && (
          <span title="The context's name reads like production. A name check only: Kubebay can't tell what the cluster really is.">
            <StatusPill tone="err">production</StatusPill>
            <VisuallyHidden> (name check only)</VisuallyHidden>
          </span>
        )}
        <span className="kb-dock-actions">
          {onYaml && (
            <Button variant="ghost" size="sm" onClick={closeActive}>
              Close YAML tab
            </Button>
          )}
          {!onYaml && binding && (
            <Button variant="ghost" size="sm" onClick={endDockShell}>
              End shell
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={closeDock}>
            Hide
          </Button>
          <PageHelp route="/terminal" align="end" />
        </span>
      </div>
      <div className="kb-dock-body">
        {tabs.map((t) => (
          <div key={t.key} className="yaml-wrap" style={t.key === activeTab ? undefined : { display: "none" }}>
            <ErrorBoundary>
              <YamlTab cluster={t.cluster} gvr={t.gvr} ns={t.ns} name={t.name} gitopsOwner={t.gitopsOwner} helmRelease={t.helmRelease} />
            </ErrorBoundary>
          </div>
        ))}
        {!showShell ? null : settings.isLoading ? null : !cap?.available ? (
          <Unavailable cap={cap} />
        ) : (
          <ErrorBoundary>
            <Suspense fallback={null}>
              <DockShell selectedCluster={selectedCluster} clusters={clusters} kubectlMissing={cap.kubectl ? !cap.kubectl.found : false} />
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
      {confirmClose && (
        <DiscardChangesModal
          onKeep={() => setConfirmClose(null)}
          onDiscard={() => {
            closeEditTab(confirmClose);
            setConfirmClose(null);
          }}
        />
      )}
    </section>
  );
}
