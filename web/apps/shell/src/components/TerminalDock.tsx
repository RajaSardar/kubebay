import { lazy, Suspense, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, InlineBanner, Splitter, StatusPill, Tabs, VisuallyHidden } from "@kubebay/ui";
import { ErrorBoundary } from "./ErrorBoundary";
import { PageHelp } from "./PageHelp";
import { DiscardChangesModal } from "./DiscardGuard";
import { NewResourceTab, YamlTab } from "./heavy";
import { isEditDirty, useEditDirty } from "../lib/editGuard";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import { settingsApi, type ClusterInfo, type LocalShellCapability } from "../lib/api";
import { bindingLooksProduction } from "../lib/localshell";
import { currentShell, setCurrentShell } from "../lib/shellSession";
import { dockBounds, useTerminalDock, type EditTab } from "../lib/terminalDock";

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

/** A YAML tab's label: its name, a dot while it holds unapplied edits, and a pill on a production-looking cluster. */
function YamlTabLabel({ tab }: { tab: EditTab }) {
  const dirty = useEditDirty(tab.key);
  const { production } = useClusterLooksProduction(tab.cluster);
  return (
    <>
      {tab.isNew ? "New resource" : `YAML ${tab.name}`}
      {dirty && (
        <>
          <span aria-hidden> ●</span>
          <VisuallyHidden> unsaved changes</VisuallyHidden>
        </>
      )}
      {production && (
        <>
          {" "}
          <StatusPill tone="err">production</StatusPill>
        </>
      )}
    </>
  );
}

function isOffline(clusters: ClusterInfo[], id: string): boolean {
  const c = clusters.find((x) => x.id === id);
  return !!c && (c.status === "unreachable" || c.status === "misconfigured" || c.connected === false);
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
  const maximized = useTerminalDock((s) => s.maximized);
  const toggleMaximized = useTerminalDock((s) => s.toggleMaximized);
  const cycleTab = useTerminalDock((s) => s.cycleTab);
  const capMessage = useTerminalDock((s) => s.capMessage);
  const dismissCapMessage = useTerminalDock((s) => s.dismissCapMessage);
  const [confirmClose, setConfirmClose] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

  // Hiding the dock is not closing a tab: with YAML tabs open the section stays
  // mounted (hidden), so an edit survives Hide and Ctrl+`.
  if (!open && tabs.length === 0) return null;

  const cap = settings.data?.localShell;
  const bounds = dockBounds(window.innerHeight);
  const shown = maximized ? bounds.max : Math.min(height, bounds.max);
  const prod = bindingLooksProduction(binding);
  const onYaml = tabs.some((t) => t.key === activeTab);
  const showShell = open && !onYaml;
  const tabIds = ["shell", ...tabs.map((t) => t.key)];
  const labels: Record<string, ReactNode> = { shell: "Shell", ...Object.fromEntries(tabs.map((t) => [t.key, <YamlTabLabel key={t.key} tab={t} />])) };
  const titleOf = (key: string) => {
    const t = tabs.find((x) => x.key === key);
    return t?.isNew ? "New resource" : `YAML ${t?.name ?? ""}`;
  };
  const activeIsNew = !!tabs.find((t) => t.key === activeTab)?.isNew;
  const closeActive = () => {
    if (isEditDirty(activeTab)) setConfirmClose(activeTab);
    else closeEditTab(activeTab);
  };

  // Keys that belong to the dock's tabs, caught only inside the dock: Ctrl+PageUp/PageDown
  // move between tabs, and Ctrl+W closes a YAML tab (the shell keeps its own Ctrl+W).
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === "PageDown" || e.key === "PageUp") {
      e.preventDefault();
      cycleTab(e.key === "PageDown" ? 1 : -1);
    } else if (e.key.toLowerCase() === "w" && onYaml) {
      e.preventDefault();
      closeActive();
    }
  };

  return (
    <section ref={dockRef} onKeyDown={onKeyDown} className="kb-dock" aria-label="Terminal" style={{ height: shown, display: open ? undefined : "none" }}>
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
          {onYaml ? titleOf(activeTab) : "Terminal"}
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
              {activeIsNew ? "Close tab" : "Close YAML tab"}
            </Button>
          )}
          {!onYaml && binding && (
            <Button variant="ghost" size="sm" onClick={endDockShell}>
              End shell
            </Button>
          )}
          <Button variant="ghost" size="sm" aria-pressed={maximized} onClick={toggleMaximized}>
            {maximized ? "Restore" : "Maximise"}
          </Button>
          <Button variant="ghost" size="sm" onClick={closeDock}>
            Hide
          </Button>
          <PageHelp route="/terminal" align="end" />
        </span>
      </div>
      {capMessage && (
        <InlineBanner
          tone="warn"
          flush
          role="alert"
          actions={
            <Button variant="ghost" onClick={dismissCapMessage}>
              Dismiss
            </Button>
          }
        >
          {capMessage}
        </InlineBanner>
      )}
      <div className="kb-dock-body">
        {tabs.map((t) => (
          <div key={t.key} className="yaml-wrap" style={t.key === activeTab ? undefined : { display: "none" }}>
            <ErrorBoundary>
              {t.isNew ? (
                <NewResourceTab cluster={selectedCluster || null} guardKey={t.key} initialKind={t.newKind} initialYaml={t.newYaml} />
              ) : (
                <>
              {isOffline(clusters, t.cluster) && (
                <InlineBanner tone="warn" flush role="alert">
                  <strong>This cluster is not connected.</strong> Your edit stays here; Apply and Dry-run are off until it is back.
                </InlineBanner>
              )}
              <YamlTab
                cluster={t.cluster}
                gvr={t.gvr}
                ns={t.ns}
                name={t.name}
                gitopsOwner={t.gitopsOwner}
                helmRelease={t.helmRelease}
                dock
                offline={isOffline(clusters, t.cluster)}
                watch={open && t.key === activeTab}
              />
                </>
              )}
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
          keys={[confirmClose]}
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
