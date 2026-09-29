import { useEffect, useRef, useState, useCallback } from "react";
import { Badge, Button, Drawer, IconButton, InlineBanner, Select, SkeletonLines, Stack, StatusDot, Tabs, TextField } from "@kubebay/ui";
import { api, nodeApi } from "../lib/api";
import { ExecTerm, YamlTab } from "./heavy";
import { EventsDrawer } from "./EventsDrawer";
import { ActionsBar } from "./ActionsBar";
import { NodeSummary } from "./NodeSummary";
import { ServiceSummary } from "./ServiceSummary";
import { MetadataSummary } from "./MetadataSummary";
import { RolloutProgress } from "./RolloutProgress";
import { AutoscalingTab } from "./AutoscalingTab";
import { PolicyFindingsTab } from "./PolicyFindingsTab";
import { RightSizingBanner } from "./RightSizingBanner";
import type { ResourceDef } from "../lib/resources";
import { ownerOf } from "../lib/gitops";

// ── Tab types per resource kind ──────────────────────────────────────────────
type NodeTab = "summary" | "shell" | "yaml";
type SvcTab = "summary" | "yaml";
type PodTab = "yaml" | "events" | "terminal";
type GenTab = "summary" | "rollout" | "autoscaling" | "policy" | "yaml" | "events";

// KEDA ScaledObjects, HPAs, and VPAs can all target these kinds — every
// other generic kind (ConfigMap, Secret, …) has nothing to autoscale.
const AUTOSCALABLE_SLUGS = new Set(["deployments", "statefulsets"]);
// The right-sizing recommender (VPA + Kubebay's own) only covers these three
// kinds — see lib/rightsizing.ts's SUPPORTED_KINDS.
const RIGHTSIZABLE_SLUGS = new Set(["deployments", "statefulsets", "daemonsets"]);

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
  // def.kind is the declared Kind; for a CRD route it is only guessed from the
  // plural, so prefer the Kind the live object reports once it has loaded.
  const eventKind = (typeof obj?.kind === "string" && obj.kind) || def.kind;

  if (isService && svcTab === "summary") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    if (obj) return <ServiceSummary obj={obj} />;
    return <div className="muted small" style={{ padding: 14 }}>Could not load service data.</div>;
  }
  if (isNode && nodeTab === "summary") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
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
        {shellErr && <InlineBanner flush>{shellErr}</InlineBanner>}
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
      <Stack className="term-wrap" style={{ height: "100%" }}>
        {containers.length > 1 && (
          <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--kb-border-subtle)", flexShrink: 0 }}>
            <Select
              value={effectiveContainer}
              onChange={(e) => onSetPodContainer(e.target.value)}
              style={{ fontSize: "var(--kb-text-xs)", height: 24 }}
            >
              {containers.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </div>
        )}
        <ExecTerm key={`${cluster}/${ns}/${name}/${effectiveContainer}`} cluster={cluster} namespace={ns} pod={name} container={effectiveContainer} />
      </Stack>
    );
  }
  if (isPod && podTab === "events") {
    return (
      <div style={{ padding: 14 }}>
        <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={eventKind} />
      </div>
    );
  }
  if (!isNode && !isService && !isPod && genTab === "summary") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    return (
      <div>
        {RIGHTSIZABLE_SLUGS.has(def.slug) && (
          <div style={{ padding: "14px 14px 0" }}>
            <RightSizingBanner cluster={cluster} ns={ns} name={name} kind={def.kind} />
          </div>
        )}
        <MetadataSummary obj={obj} />
      </div>
    );
  }
  if (!isNode && !isService && !isPod && genTab === "rollout") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    return <RolloutProgress cluster={cluster} namespace={ns} obj={obj} />;
  }
  if (!isNode && !isService && !isPod && genTab === "autoscaling") {
    return <AutoscalingTab cluster={cluster} ns={ns} name={name} kind={def.kind} />;
  }
  if (!isNode && !isService && !isPod && genTab === "policy") {
    return <PolicyFindingsTab cluster={cluster} ns={ns} name={name} kind={def.kind} />;
  }
  if ((isNode && nodeTab === "yaml") || (isService && svcTab === "yaml") || (isPod && podTab === "yaml") || (!isNode && !isService && !isPod && genTab === "yaml")) {
    return (
      <div className="yaml-wrap">
        <YamlTab cluster={cluster} gvr={def.gvr} ns={ns} name={name} gitopsOwner={ownerOf(obj)} />
      </div>
    );
  }
  if (!isNode && !isService && !isPod && genTab === "events") {
    return (
      <div style={{ padding: 14 }}>
        <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={eventKind} />
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
function PaneTabs<T extends string>(props: {
  tabs: readonly T[];
  active: T;
  labels: Record<T, string>;
  onChange: (t: T) => void;
}) {
  return <Tabs {...props} className="drawer-pane-tabs" />;
}

// ── Main component ────────────────────────────────────────────────────────────
export default function GenericDrawer({
  cluster,
  def,
  ns,
  name,
  onClose,
  onPopOut,
  embedded,
  initialTab,
}: {
  cluster: string;
  def: ResourceDef;
  ns: string;
  name: string;
  onClose: () => void;
  onPopOut?: () => void;
  /** Fill the full-page resource view instead of sliding over the list. */
  embedded?: boolean;
  /** Open on the YAML tab (the row menu's "Edit YAML") instead of the summary. */
  initialTab?: "yaml";
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
  const [nodeTab, setNodeTab] = useState<NodeTab>(initialTab ?? "summary");
  const [svcTab, setSvcTab] = useState<SvcTab>(initialTab ?? "summary");
  const [podTab, setPodTab] = useState<PodTab>("yaml");
  const [podContainer, setPodContainer] = useState("");
  const [genTab, setGenTab] = useState<GenTab>(initialTab ?? "summary");

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
    api.getObject(cluster, def.gvr, ns, name)
      .then((o) => setObj(o))
      .catch(() => setObj(null))
      .finally(() => setObjLoading(false));
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
  const genTabLabels: Record<GenTab, string> = { summary: "Summary", rollout: "Rollout", autoscaling: "Autoscaling", policy: "Policy", yaml: "YAML", events: "Events" };
  // Rollout progress only makes sense for Deployments (old-RS-vs-new-RS
  // replica counts); Autoscaling only for kinds an HPA/VPA/ScaledObject can
  // target. Policy findings apply to any resource except a PolicyReport
  // itself (findings about findings would be circular). Every other
  // generic kind keeps the plain three tabs.
  const genTabs: GenTab[] = [
    "summary",
    ...(def.slug === "deployments" ? (["rollout"] as const) : []),
    ...(AUTOSCALABLE_SLUGS.has(def.slug) ? (["autoscaling"] as const) : []),
    ...(def.slug !== "policyreports" && def.slug !== "clusterpolicyreports" ? (["policy"] as const) : []),
    "yaml",
    "events",
  ];

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
    <Drawer
      title={name}
      subtitle={def.scoped ? def.label : ns}
      leading={<StatusDot status="connected" />}
      onClose={onClose}
      embedded={embedded}
      actions={
        <>
          {!confirming ? (
            <>
              {onPopOut && (
                <IconButton label="Open full page" title="Open full page (⌘⇧↵)" onClick={onPopOut}>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <rect x="1" y="1" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                    <path d="M8 2.5h3.5V6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M11.5 2.5L7.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  </svg>
                </IconButton>
              )}
              {/* Split view toggle */}
              <IconButton label="Toggle split view" title="Split view (⌘⇧S)" active={split} onClick={toggleSplit}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <rect x="1" y="1" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                  <rect x="8" y="1" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                </svg>
              </IconButton>
              <Button variant="danger-ghost" onClick={() => setConfirming(true)}>
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
              <TextField
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
        </>
      }
    >

      {/* ── Error banner ── */}
      {err && (
        <InlineBanner flush style={{ margin: "10px 14px 0" }}>
          {err}
        </InlineBanner>
      )}

      {/* ── Actions bar ── */}
      {["deployments", "statefulsets", "daemonsets", "cronjobs", "nodes"].includes(def.slug) && (
        <ActionsBar slug={def.slug as "deployments"} cluster={cluster} ns={ns} name={name} gitopsOwner={ownerOf(obj)} />
      )}

      {/* ── Single-pane tab bar (only when not split) ── */}
      {!split && isNode && (
        <Tabs tabs={["summary", "shell", "yaml"] as const} active={nodeTab} labels={nodeTabLabels} onChange={setNodeTab} />
      )}
      {!split && isService && (
        <Tabs tabs={["summary", "yaml"] as const} active={svcTab} labels={svcTabLabels} onChange={setSvcTab} />
      )}
      {!split && isPod && (
        <Tabs tabs={["yaml", "events", "terminal"] as const} active={podTab} labels={podTabLabels} onChange={setPodTab} />
      )}
      {!split && !isNode && !isService && !isPod && (
        <Tabs tabs={genTabs} active={genTab} labels={genTabLabels} onChange={setGenTab} />
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
                tabs={genTabs}
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
                tabs={genTabs}
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
    </Drawer>
  );
}
