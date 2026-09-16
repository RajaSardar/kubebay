import { useEffect, useRef, useState, useCallback } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { api, nodeApi } from "../lib/api";
import { YamlTab } from "./YamlTab";
import { EventsDrawer } from "./EventsDrawer";
import { ExecTerm } from "./ExecTerm";
import { ActionsBar } from "./ActionsBar";
import { NodeSummary } from "./NodeSummary";
import { ServiceSummary } from "./ServiceSummary";
import type { ResourceDef } from "../lib/resources";

// ── Tab types per resource kind ──────────────────────────────────────────────
type NodeTab = "summary" | "shell" | "yaml";
type SvcTab = "summary" | "yaml";
type GenTab = "yaml" | "events";

// ── Split-pane drag handle ────────────────────────────────────────────────────
function SplitDivider({
  onDrag,
}: {
  onDrag: (dx: number) => void;
}) {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      lastX.current = e.clientX;
      e.preventDefault();

      function onMove(ev: MouseEvent) {
        if (!dragging.current) return;
        const dx = ev.clientX - lastX.current;
        lastX.current = ev.clientX;
        onDrag(dx);
      }
      function onUp() {
        dragging.current = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onDrag],
  );

  return <div className="drawer-divider" onMouseDown={onMouseDown} title="Drag to resize" />;
}

// ── Render a single pane's content ───────────────────────────────────────────
function PaneContent({
  isNode,
  isService,
  nodeTab,
  svcTab,
  genTab,
  cluster,
  def,
  ns,
  name,
  obj,
  objLoading,
  shellPod,
  shellErr,
  creating,
  onStartShell,
}: {
  isNode: boolean;
  isService: boolean;
  nodeTab: NodeTab;
  svcTab: SvcTab;
  genTab: GenTab;
  cluster: string;
  def: ResourceDef;
  ns: string;
  name: string;
  obj: Record<string, unknown> | null;
  objLoading: boolean;
  shellPod: { ns: string; pod: string } | null;
  shellErr: string;
  creating: boolean;
  onStartShell: () => void;
}) {
  if (isService && svcTab === "summary") {
    if (objLoading) return <div className="muted small" style={{ padding: 14 }}>Loading…</div>;
    if (obj) return <ServiceSummary obj={obj} />;
    return <div className="muted small" style={{ padding: 14 }}>Could not load service data.</div>;
  }
  if (isNode && nodeTab === "summary") {
    if (objLoading) return <div className="muted small" style={{ padding: 14 }}>Loading…</div>;
    if (obj) return <NodeSummary obj={obj} />;
    return <div className="muted small" style={{ padding: 14 }}>Could not load node data.</div>;
  }
  if (isNode && nodeTab === "shell") {
    if (shellPod) {
      return (
        <div className="term-wrap">
          <ExecTerm cluster={cluster} namespace={shellPod.ns} pod={shellPod.pod} container="shell" shell="sh" />
        </div>
      );
    }
    return (
      <div className="page" style={{ paddingTop: 24 }}>
        {shellErr && <div className="error-banner">{shellErr}</div>}
        <p className="muted small" style={{ marginTop: 0 }}>
          Starts a short-lived privileged helper pod (busybox + hostPID) pinned to{" "}
          <span className="mono">{name}</span>, giving you a root shell on the node.
          It is deleted automatically when this panel closes.
        </p>
        <Button disabled={creating} onClick={onStartShell}>
          {creating ? "Creating…" : "Start node shell"}
        </Button>
      </div>
    );
  }
  if ((isNode && nodeTab === "yaml") || (isService && svcTab === "yaml") || (!isNode && !isService && genTab === "yaml")) {
    return (
      <div className="yaml-wrap">
        <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
      </div>
    );
  }
  if (!isNode && !isService && genTab === "events") {
    return (
      <div style={{ padding: 14 }}>
        <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={def.label} />
      </div>
    );
  }
  return null;
}

// ── Mini tab bar for a pane ───────────────────────────────────────────────────
function PaneTabs<T extends string>({
  tabs,
  active,
  labels,
  onChange,
}: {
  tabs: readonly T[];
  active: T;
  labels: Record<T, string>;
  onChange: (t: T) => void;
}) {
  return (
    <div className="drawer-pane-tabs">
      {tabs.map((t) => (
        <button
          key={t}
          className={`tab${active === t ? " active" : ""}`}
          onClick={() => onChange(t)}
        >
          {labels[t]}
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GenericDrawer({
  cluster,
  def,
  ns,
  name,
  onClose,
  onPopOut,
}: {
  cluster: string;
  def: ResourceDef;
  ns: string;
  name: string;
  onClose: () => void;
  onPopOut?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [force, setForce] = useState(false);

  const isNode = def.slug === "nodes";
  const isService = def.slug === "services";

  // Per-kind split persistence key
  const splitKey = `kb.split.${def.slug}`;

  // ── Single-pane tab state ────────────────────────────────────────────────
  const [nodeTab, setNodeTab] = useState<NodeTab>("summary");
  const [svcTab, setSvcTab] = useState<SvcTab>("summary");
  const [genTab, setGenTab] = useState<GenTab>("yaml");

  // ── Split-pane state ─────────────────────────────────────────────────────
  const [split, setSplit] = useState<boolean>(() => {
    try {
      return localStorage.getItem(splitKey) === "1";
    } catch {
      return false;
    }
  });

  // Per-pane tab state for split mode
  const defaultLeftNodeTab: NodeTab = "summary";
  const defaultRightNodeTab: NodeTab = "yaml";
  const defaultLeftSvcTab: SvcTab = "summary";
  const defaultRightSvcTab: SvcTab = "yaml";
  const defaultLeftGenTab: GenTab = "events";
  const defaultRightGenTab: GenTab = "yaml";

  const [leftNodeTab, setLeftNodeTab] = useState<NodeTab>(defaultLeftNodeTab);
  const [rightNodeTab, setRightNodeTab] = useState<NodeTab>(defaultRightNodeTab);
  const [leftSvcTab, setLeftSvcTab] = useState<SvcTab>(defaultLeftSvcTab);
  const [rightSvcTab, setRightSvcTab] = useState<SvcTab>(defaultRightSvcTab);
  const [leftGenTab, setLeftGenTab] = useState<GenTab>(defaultLeftGenTab);
  const [rightGenTab, setRightGenTab] = useState<GenTab>(defaultRightGenTab);

  // Pane width in percent (left pane)
  const [leftPct, setLeftPct] = useState(50);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleSplitDrag = useCallback((dx: number) => {
    setLeftPct((prev) => {
      const container = containerRef.current;
      if (!container) return prev;
      const totalW = container.getBoundingClientRect().width;
      if (totalW === 0) return prev;
      const deltaPct = (dx / totalW) * 100;
      return Math.min(80, Math.max(20, prev + deltaPct));
    });
  }, []);

  function toggleSplit() {
    setSplit((s) => {
      const next = !s;
      try {
        if (next) localStorage.setItem(splitKey, "1");
        else localStorage.removeItem(splitKey);
      } catch {
        // ignore
      }
      return next;
    });
  }

  // ── Object loading ───────────────────────────────────────────────────────
  const [obj, setObj] = useState<Record<string, unknown> | null>(null);
  const [objLoading, setObjLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [shellPod, setShellPod] = useState<{ ns: string; pod: string } | null>(null);
  const [shellErr, setShellErr] = useState("");

  async function startShell() {
    setCreating(true);
    setShellErr("");
    try {
      const r = await nodeApi.shellStart({ cluster, node: name });
      setShellPod({ ns: r.namespace, pod: r.pod });
    } catch (e) {
      setShellErr(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    return () => {
      if (shellPod) {
        void api
          .deleteResource({ cluster, gvr: "v1/pods", ns: shellPod.ns, name: shellPod.pod })
          .catch(() => undefined);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setConfirming(false);
    setInput("");
    setErr("");
  }, [name, ns]);

  // ⌘⇧Enter → pop out to full page
  useEffect(() => {
    if (!onPopOut) return;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        onPopOut!();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPopOut]);

  // ⌘⇧S → toggle split
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        toggleSplit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitKey]);

  useEffect(() => {
    if (!isNode && !isService) return;
    setObjLoading(true);
    api.getYamlText(cluster, def.gvr, ns, name).then((text) => {
      try {
        setObj(JSON.parse(text));
      } catch {
        setObj(null);
      }
    }).catch(() => setObj(null)).finally(() => setObjLoading(false));
  }, [cluster, def.gvr, ns, name, isNode, isService]);

  async function doDelete() {
    if (input !== name) {
      setErr("Name does not match.");
      return;
    }
    setDeleting(true);
    try {
      await api.deleteResource({
        cluster,
        gvr: def.gvr,
        ns,
        name,
        graceSeconds: force ? 0 : undefined,
        forceFinalizers: force,
      });
      onClose();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
  }

  // ── Tab label maps ───────────────────────────────────────────────────────
  const nodeTabLabels: Record<NodeTab, string> = { summary: "Summary", shell: "Terminal", yaml: "YAML" };
  const svcTabLabels: Record<SvcTab, string> = { summary: "Summary", yaml: "YAML" };
  const genTabLabels: Record<GenTab, string> = { yaml: "YAML", events: "Events" };

  // ── Shared pane content props ────────────────────────────────────────────
  const sharedContentProps = {
    isNode,
    isService,
    cluster,
    def,
    ns,
    name,
    obj,
    objLoading,
    shellPod,
    shellErr,
    creating,
    onStartShell: () => void startShell(),
  };

  return (
    <aside className="drawer">
      {/* ── Header ── */}
      <div className="drawer-head">
        <StatusDot status="connected" />
        <div style={{ minWidth: 0 }}>
          <div className="mono strong">{name}</div>
          <div className="muted small mono">{def.scoped ? def.label : ns}</div>
        </div>
        <div className="drawer-head-actions">
          {!confirming ? (
            <>
              {onPopOut && (
                <button
                  className="drawer-popout-btn"
                  onClick={onPopOut}
                  title="Open full page (⌘⇧↵)"
                  aria-label="Open full page"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                    <path d="M8 2.5h3.5V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11.5 2.5L7.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </button>
              )}
              {/* Split view toggle */}
              <button
                className={`drawer-popout-btn${split ? " active" : ""}`}
                onClick={toggleSplit}
                title="Split view (⌘⇧S)"
                aria-label="Toggle split view"
                aria-pressed={split}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <rect x="1" y="1" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                  <rect x="8" y="1" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                </svg>
              </button>
              <Button variant="ghost" className="kb-btn-danger-ghost" onClick={() => setConfirming(true)}>
                Delete
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </>
          ) : (
            <>
              <label className="ctl" style={{ cursor: "pointer" }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                force
              </label>
              <Badge tone="err">type name to confirm</Badge>
              <input
                className="toolbar-input"
                style={{ maxWidth: 180 }}
                placeholder={name}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
              />
              <Button variant="danger" disabled={deleting} onClick={() => void doDelete()}>
                Confirm
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setConfirming(false);
                  setInput("");
                  setErr("");
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Error banner ── */}
      {err && (
        <div className="error-banner" style={{ margin: "10px 14px 0" }}>
          {err}
        </div>
      )}

      {/* ── Actions bar ── */}
      {["deployments", "statefulsets", "daemonsets", "cronjobs", "nodes"].includes(def.slug) && (
        <ActionsBar slug={def.slug as "deployments"} cluster={cluster} ns={ns} name={name} />
      )}

      {/* ── Single-pane tab bar (only when not split) ── */}
      {!split && isNode && (
        <div className="tabs">
          {(["summary", "shell", "yaml"] as const).map((t) => (
            <button key={t} className={`tab${nodeTab === t ? " active" : ""}`} onClick={() => setNodeTab(t)}>
              {nodeTabLabels[t]}
            </button>
          ))}
        </div>
      )}
      {!split && isService && (
        <div className="tabs">
          {(["summary", "yaml"] as const).map((t) => (
            <button key={t} className={`tab${svcTab === t ? " active" : ""}`} onClick={() => setSvcTab(t)}>
              {svcTabLabels[t]}
            </button>
          ))}
        </div>
      )}
      {!split && !isNode && !isService && (
        <div className="tabs">
          {(["yaml", "events"] as const).map((t) => (
            <button key={t} className={`tab${genTab === t ? " active" : ""}`} onClick={() => setGenTab(t)}>
              {genTabLabels[t]}
            </button>
          ))}
        </div>
      )}

      {/* ── Content area ── */}
      {split ? (
        /* ── Split layout ── */
        <div className="drawer-split" ref={containerRef}>
          {/* Left pane */}
          <div className="drawer-pane" style={{ flex: `0 0 ${leftPct}%` }}>
            {isNode && (
              <PaneTabs
                tabs={["summary", "shell", "yaml"] as const}
                active={leftNodeTab}
                labels={nodeTabLabels}
                onChange={setLeftNodeTab}
              />
            )}
            {isService && (
              <PaneTabs
                tabs={["summary", "yaml"] as const}
                active={leftSvcTab}
                labels={svcTabLabels}
                onChange={setLeftSvcTab}
              />
            )}
            {!isNode && !isService && (
              <PaneTabs
                tabs={["yaml", "events"] as const}
                active={leftGenTab}
                labels={genTabLabels}
                onChange={setLeftGenTab}
              />
            )}
            <div className="drawer-pane-body">
              <PaneContent
                {...sharedContentProps}
                nodeTab={leftNodeTab}
                svcTab={leftSvcTab}
                genTab={leftGenTab}
              />
            </div>
          </div>

          {/* Divider */}
          <SplitDivider onDrag={handleSplitDrag} />

          {/* Right pane */}
          <div className="drawer-pane" style={{ flex: `1 1 0` }}>
            {isNode && (
              <PaneTabs
                tabs={["summary", "shell", "yaml"] as const}
                active={rightNodeTab}
                labels={nodeTabLabels}
                onChange={setRightNodeTab}
              />
            )}
            {isService && (
              <PaneTabs
                tabs={["summary", "yaml"] as const}
                active={rightSvcTab}
                labels={svcTabLabels}
                onChange={setRightSvcTab}
              />
            )}
            {!isNode && !isService && (
              <PaneTabs
                tabs={["yaml", "events"] as const}
                active={rightGenTab}
                labels={genTabLabels}
                onChange={setRightGenTab}
              />
            )}
            <div className="drawer-pane-body">
              <PaneContent
                {...sharedContentProps}
                nodeTab={rightNodeTab}
                svcTab={rightSvcTab}
                genTab={rightGenTab}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ── Single-pane content ── */
        <>
          {isService && svcTab === "summary" ? (
            objLoading ? (
              <div className="muted small" style={{ padding: 14 }}>Loading…</div>
            ) : obj ? (
              <ServiceSummary obj={obj} />
            ) : (
              <div className="muted small" style={{ padding: 14 }}>Could not load service data.</div>
            )
          ) : isNode && nodeTab === "summary" ? (
            objLoading ? (
              <div className="muted small" style={{ padding: 14 }}>Loading…</div>
            ) : obj ? (
              <NodeSummary obj={obj} />
            ) : (
              <div className="muted small" style={{ padding: 14 }}>Could not load node data.</div>
            )
          ) : isNode && nodeTab === "shell" ? (
            shellPod ? (
              <div className="term-wrap">
                <ExecTerm cluster={cluster} namespace={shellPod.ns} pod={shellPod.pod} container="shell" shell="sh" />
              </div>
            ) : (
              <div className="page" style={{ paddingTop: 24 }}>
                {shellErr && <div className="error-banner">{shellErr}</div>}
                <p className="muted small" style={{ marginTop: 0 }}>
                  Starts a short-lived privileged helper pod (busybox + hostPID) pinned to{" "}
                  <span className="mono">{name}</span>, giving you a root shell on the node.
                  It is deleted automatically when this panel closes.
                </p>
                <Button disabled={creating} onClick={() => void startShell()}>
                  {creating ? "Creating…" : "Start node shell"}
                </Button>
              </div>
            )
          ) : isNode && nodeTab === "yaml" ? (
            <div className="yaml-wrap">
              <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
            </div>
          ) : isService && svcTab === "yaml" ? (
            <div className="yaml-wrap">
              <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
            </div>
          ) : !isNode && !isService && genTab === "yaml" ? (
            <div className="yaml-wrap">
              <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
            </div>
          ) : !isNode && !isService && genTab === "events" ? (
            <div style={{ padding: 14 }}>
              <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={def.label} />
            </div>
          ) : null}
        </>
      )}
    </aside>
  );
}
