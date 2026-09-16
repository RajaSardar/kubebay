import { useEffect, useRef, useState, useCallback } from "react";
import { Badge, Button, StatusDot } from "@kubebay/ui";
import { api, nodeApi } from "../lib/api";
import { YamlTab } from "./YamlTab";
import { EventsDrawer } from "./EventsDrawer";
import { ExecTerm } from "./ExecTerm";
import { ActionsBar } from "./ActionsBar";
import { NodeSummary } from "./NodeSummary";
import { ServiceSummary } from "./ServiceSummary";
import { MetadataSummary } from "./MetadataSummary";
import type { ResourceDef } from "../lib/resources";

// ── Tab types per resource kind ──────────────────────────────────────────────
type NodeTab = "summary" | "shell" | "yaml";
type SvcTab = "summary" | "yaml";
type PodTab = "yaml" | "events" | "terminal";
type GenTab = "summary" | "yaml" | "events";

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
  isPod,
  nodeTab,
  svcTab,
  podTab,
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
  podContainer,
  onSetPodContainer,
}: {
  isNode: boolean;
  isService: boolean;
  isPod: boolean;
  nodeTab: NodeTab;
  svcTab: SvcTab;
  podTab: PodTab;
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
  podContainer: string;
  onSetPodContainer: (c: string) => void;
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
  if (isPod && podTab === "terminal") {
    const containers = parsePodContainers(obj);
    const effectiveContainer = podContainer || containers[0] || "";
    return (
      <div className="term-wrap" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
        {containers.length > 1 && (
          <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--kb-border-subtle)", flexShrink: 0 }}>
            <select
              className="toolbar-select"
              value={effectiveContainer}
              onChange={(e) => onSetPodContainer(e.target.value)}
              style={{ fontSize: 11, height: 24 }}
            >
              {containers.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <ExecTerm key={`${cluster}/${ns}/${name}/${effectiveContainer}`} cluster={cluster} namespace={ns} pod={name} container={effectiveContainer} />
      </div>
    );
  }
  if (isPod && podTab === "events") {
    return (
      <div style={{ padding: 14 }}>
        <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={def.label} />
      </div>
    );
  }
  if (!isNode && !isService && !isPod && genTab === "summary") {
    if (objLoading) return <div className="muted small" style={{ padding: 14 }}>Loading…</div>;
    return <MetadataSummary obj={obj} />;
  }
  if ((isNode && nodeTab === "yaml") || (isService && svcTab === "yaml") || (isPod && podTab === "yaml") || (!isNode && !isService && !isPod && genTab === "yaml")) {
    return (
      <div className="yaml-wrap">
        <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} />
      </div>
    );
  }
  if (!isNode && !isService && !isPod && genTab === "events") {
    return (
      <div style={{ padding: 14 }}>
        <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={def.label} />
      </div>
    );
  }
  return null;
}

function parsePodContainers(obj: Record<string, unknown> | null): string[] {
  if (!obj) return [];
  const spec = (obj.spec ?? {}) as Record<string, unknown>;
  const containers = (spec.containers ?? []) as Array<Record<string, unknown>>;
  return containers.map((c) => c.name as string).filter(Boolean);
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
  const isPod = def.slug === "pods";

  // Per-kind split persistence key
  const splitKey = `kb.split.${def.slug}`;

  // ── Single-pane tab state ────────────────────────────────────────────────
  const [nodeTab, setNodeTab] = useState<NodeTab>("summary");
  const [svcTab, setSvcTab] = useState<SvcTab>("summary");
  const [podTab, setPodTab] = useState<PodTab>("yaml");
  const [podContainer, setPodContainer] = useState("");
  const [genTab, setGenTab] = useState<GenTab>("summary");

  // ── Split-pane state ─────────────────────────────────────────────────────
  const [split, setSplit] = useState<boolean>(() => {
    try {
      return localStorage.getItem(splitKey) === "1";
    } catch {
      return false;
    }
  });

  // Per-pane tab state for split mode
  const [leftNodeTab, setLeftNodeTab] = useState<NodeTab>("summary");
  const [rightNodeTab, setRightNodeTab] = useState<NodeTab>("yaml");
  const [leftSvcTab, setLeftSvcTab] = useState<SvcTab>("summary");
  const [rightSvcTab, setRightSvcTab] = useState<SvcTab>("yaml");
  const [leftPodTab, setLeftPodTab] = useState<PodTab>("yaml");
  const [rightPodTab, setRightPodTab] = useState<PodTab>("terminal");
  const [leftGenTab, setLeftGenTab] = useState<GenTab>("events");
  const [rightGenTab, setRightGenTab] = useState<GenTab>("yaml");

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
  // Mirrors shellPod for the cleanup effect below — a mount-time effect closure
  // would otherwise always see the `null` shellPod had at first render, since
  // it's only set later, asynchronously, once startShell() resolves. That stale
  // closure meant the privileged node-shell pod was never actually deleted on
  // drawer close, despite the UI promising it would be.
  const shellPodRef = useRef<{ ns: string; pod: string } | null>(null);

  async function startShell() {
    setCreating(true);
    setShellErr("");
    try {
      const r = await nodeApi.shellStart({ cluster, node: name });
      const pod = { ns: r.namespace, pod: r.pod };
      shellPodRef.current = pod;
      setShellPod(pod);
    } catch (e) {
      setShellErr(String(e instanceof Error ? e.message : e));
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    return () => {
      const pod = shellPodRef.current;
      if (pod) {
        void api
          .deleteResource({ cluster, gvr: "v1/pods", ns: pod.ns, name: pod.pod })
          .catch(() => undefined);
      }
    };
  }, [cluster]);

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
    // Fetched for every kind: Node/Service/Pod use it for their bespoke summary, and generic
    // kinds use it for the Summary tab (MetadataSummary) added alongside YAML + Events.
    setObjLoading(true);
    api.getYamlText(cluster, def.gvr, ns, name).then((text) => {
      try {
        setObj(JSON.parse(text));
      } catch {
        setObj(null);
      }
    }).catch(() => setObj(null)).finally(() => setObjLoading(false));
    // Reset container selection when pod changes
    if (isPod) setPodContainer("");
  }, [cluster, def.gvr, ns, name, isPod]);

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
  const podTabLabels: Record<PodTab, string> = { yaml: "YAML", events: "Events", terminal: "Terminal" };
  const genTabLabels: Record<GenTab, string> = { summary: "Summary", yaml: "YAML", events: "Events" };

  // ── Shared pane content props ────────────────────────────────────────────
  const sharedContentProps = {
    isNode,
    isService,
    isPod,
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
    podContainer,
    onSetPodContainer: setPodContainer,
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
      {!split && isPod && (
        <div className="tabs">
          {(["yaml", "events", "terminal"] as const).map((t) => (
            <button key={t} className={`tab${podTab === t ? " active" : ""}`} onClick={() => setPodTab(t)}>
              {podTabLabels[t]}
            </button>
          ))}
        </div>
      )}
      {!split && !isNode && !isService && !isPod && (
        <div className="tabs">
          {(["summary", "yaml", "events"] as const).map((t) => (
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
            {isPod && (
              <PaneTabs
                tabs={["yaml", "events", "terminal"] as const}
                active={leftPodTab}
                labels={podTabLabels}
                onChange={setLeftPodTab}
              />
            )}
            {!isNode && !isService && !isPod && (
              <PaneTabs
                tabs={["summary", "yaml", "events"] as const}
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
                podTab={leftPodTab}
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
            {isPod && (
              <PaneTabs
                tabs={["yaml", "events", "terminal"] as const}
                active={rightPodTab}
                labels={podTabLabels}
                onChange={setRightPodTab}
              />
            )}
            {!isNode && !isService && !isPod && (
              <PaneTabs
                tabs={["summary", "yaml", "events"] as const}
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
                podTab={rightPodTab}
                genTab={rightGenTab}
              />
            </div>
          </div>
        </div>
      ) : (
        /* ── Single-pane content ── */
        <PaneContent
          {...sharedContentProps}
          nodeTab={nodeTab}
          svcTab={svcTab}
          podTab={podTab}
          genTab={genTab}
        />
      )}
    </aside>
  );
}
