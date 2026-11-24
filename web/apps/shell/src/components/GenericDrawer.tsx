import { useEffect, useRef, useState, useCallback } from "react";
import { useCompare } from "../lib/compare-store";
import { Badge, Button, Drawer, IconButton, InlineBanner, SkeletonLines, StatusDot, Tabs, TextField } from "@kubebay/ui";
import { api, nodeApi } from "../lib/api";
import { ExecTerm } from "./heavy";
import { useDiscardGuard } from "./DiscardGuard";
import { DrawerYaml } from "./DrawerYaml";
import { EventsDrawer } from "./EventsDrawer";
import { ObjectStarButton } from "./Favorites";
import { WarningSparkline } from "./WarningSparkline";
import { WorkloadHealthChip } from "./WorkloadHealthChip";
import { ActionsBar } from "./ActionsBar";
import { NodeSummary } from "./NodeSummary";
import { ServiceSummary } from "./ServiceSummary";
import { NamespaceSummary } from "./NamespaceSummary";
import { MetadataSummary } from "./MetadataSummary";
import { ResourceClaimSummary } from "./ResourceClaimSummary";
import { RolloutProgress } from "./RolloutProgress";
import { WorkloadPods } from "./WorkloadPods";
import { RolloutLine } from "./RolloutLine";
import { AutoscalingTab } from "./AutoscalingTab";
import { PolicyFindingsTab } from "./PolicyFindingsTab";
import { WorkloadVulnerabilitiesTab } from "./WorkloadVulnerabilitiesTab";
import { WorkloadSignaturesTab } from "./WorkloadSignaturesTab";
import { TimelineTab } from "./TimelineTab";
import { RightSizingBanner } from "./RightSizingBanner";
import type { ResourceDef } from "../lib/resources";
import { helmReleaseOf, ownerOf } from "../lib/gitops";
import { drawerChord } from "../lib/drawerKeys";

// ── Tab types per resource kind ──────────────────────────────────────────────
type NodeTab = "summary" | "shell" | "yaml";
type SvcTab = "summary" | "yaml";
/** An Argo Rollout, at whichever version its CRD serves. */
const isArgoRollout = (gvr: string) => /^argoproj\.io\/[^/]+\/rollouts$/.test(gvr);

type GenTab = "summary" | "rollout" | "timeline" | "autoscaling" | "policy" | "vulnerabilities" | "signatures" | "yaml" | "events";

// KEDA ScaledObjects, HPAs, and VPAs can all target these kinds — every
// other generic kind (ConfigMap, Secret, …) has nothing to autoscale.
const AUTOSCALABLE_SLUGS = new Set(["deployments", "statefulsets"]);
// The right-sizing recommender (VPA + Kubebay's own) only covers these three
// kinds — see lib/rightsizing.ts's SUPPORTED_KINDS.
const RIGHTSIZABLE_SLUGS = new Set(["deployments", "statefulsets", "daemonsets"]);
// Workloads whose Summary ends with a table of their pods.
const POD_OWNER_SLUGS = new Set(["deployments", "statefulsets", "daemonsets", "jobs"]);

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
  isNamespace,
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
  onGenTab,
}: {
  isNode: boolean;
  isService: boolean;
  isNamespace: boolean;
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
  /** Switches this pane's tab, for content that leads to another tab. */
  onGenTab?: (tab: GenTab) => void;
}) {
  // def.kind is the declared Kind; for a CRD route it is only guessed from the
  // plural, so prefer the Kind the live object reports once it has loaded.
  const eventKind = (typeof obj?.kind === "string" && obj.kind) || def.kind;

  if (isNamespace && genTab === "summary") {
    return <NamespaceSummary cluster={cluster} namespace={name} />;
  }
  if (isService && svcTab === "summary") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    if (obj) return <ServiceSummary obj={obj} cluster={cluster} />;
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
          <ExecTerm cluster={cluster} namespace={shellPod.ns} pod={shellPod.pod} container="shell" shell="node" />
        </div>
      );
    }
    return (
      <div className="page" style={{ paddingTop: 24 }}>
        {shellErr && <InlineBanner flush>{shellErr}</InlineBanner>}
        <p className="muted small" style={{ marginTop: 0 }}>
          Starts a short-lived privileged helper pod pinned to <span className="mono">{name}</span>, then
          nsenters into the node's own mount/PID/network namespaces — a real root shell on the node itself
          (its filesystem, processes, and network), not just the helper pod's own. It is deleted automatically
          when this panel closes.
        </p>
        <Button disabled={creating} onClick={onStartShell}>
          {creating ? "Creating…" : "Start node shell"}
        </Button>
      </div>
    );
  }
  if (!isNode && !isService && genTab === "summary") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    return (
      <div>
        {RIGHTSIZABLE_SLUGS.has(def.slug) && (
          <div style={{ padding: "14px 14px 0" }}>
            <RightSizingBanner cluster={cluster} ns={ns} name={name} kind={def.kind} />
          </div>
        )}
        {RIGHTSIZABLE_SLUGS.has(def.slug) && obj && <WarningSparkline cluster={cluster} obj={obj} style={{ padding: "14px 14px 0" }} />}
        {RIGHTSIZABLE_SLUGS.has(def.slug) && obj && <WorkloadHealthChip cluster={cluster} obj={obj} style={{ padding: "8px 14px 0" }} />}
        {RIGHTSIZABLE_SLUGS.has(def.slug) && obj && (
          <RolloutLine cluster={cluster} obj={obj} onShowRollout={onGenTab && (() => onGenTab("rollout"))} style={{ padding: "8px 14px 0" }} />
        )}
        {def.slug === "resourceclaims" && obj && <ResourceClaimSummary obj={obj} />}
        <MetadataSummary obj={obj} cluster={cluster} ns={ns} />
        {POD_OWNER_SLUGS.has(def.slug) && obj && <WorkloadPods cluster={cluster} obj={obj} kind={def.kind} />}
      </div>
    );
  }
  if (!isNode && !isService && genTab === "rollout") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    return <RolloutProgress cluster={cluster} namespace={ns} obj={obj} />;
  }
  if (!isNode && !isService && genTab === "timeline") {
    if (objLoading) return <SkeletonLines lines={6} label="Loading details…" />;
    return (
      <div style={{ padding: 14 }}>
        <TimelineTab cluster={cluster} ns={ns} obj={obj} />
      </div>
    );
  }
  if (!isNode && !isService && genTab === "autoscaling") {
    return <AutoscalingTab cluster={cluster} ns={ns} name={name} kind={def.kind} />;
  }
  if (!isNode && !isService && genTab === "policy") {
    return <PolicyFindingsTab cluster={cluster} ns={ns} name={name} kind={def.kind} />;
  }
  if (!isNode && !isService && genTab === "vulnerabilities") {
    return <WorkloadVulnerabilitiesTab cluster={cluster} ns={ns} name={name} kind={def.kind} />;
  }
  if (!isNode && !isService && genTab === "signatures") {
    if (objLoading) return <SkeletonLines lines={4} label="Loading details…" />;
    return <WorkloadSignaturesTab cluster={cluster} ns={ns} obj={obj} />;
  }
  if ((isNode && nodeTab === "yaml") || (isService && svcTab === "yaml") || (!isNode && !isService && genTab === "yaml")) {
    return (
      <div className="yaml-wrap">
        <DrawerYaml cluster={cluster} gvr={def.gvr} ns={ns} name={name} gitopsOwner={ownerOf(obj)} helmRelease={helmReleaseOf(obj)} />
      </div>
    );
  }
  if (!isNode && !isService && genTab === "events") {
    return (
      <div style={{ padding: 14 }}>
        <EventsDrawer cluster={cluster} namespace={ns} name={name} kind={eventKind} />
      </div>
    );
  }
  return null;
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
  onClose: onCloseNow,
  initialTab,
}: {
  cluster: string;
  def: ResourceDef;
  ns: string;
  name: string;
  onClose: () => void;
  /** Open on the YAML tab (the row menu's "Edit YAML") instead of the summary. */
  initialTab?: "yaml";
}) {
  // Closing or changing tab drops an open YAML editor: ask first if it holds unapplied edits.
  const { guard, modal: discardModal } = useDiscardGuard();
  const onClose = guard(onCloseNow);
  // A tab click that changes nothing never prompts.
  const guardTab = <T extends string>(current: T, set: (t: T) => void) => (t: T) => {
    if (t !== current) guard(set)(t);
  };
  const [confirming, setConfirming] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [force, setForce] = useState(false);

  const isNode = def.slug === "nodes";
  const isService = def.slug === "services";
  const isNamespace = def.slug === "namespaces";

  // Per-kind split persistence key
  const splitKey = `kb.split.${def.slug}`;

  // ── Single-pane tab state ────────────────────────────────────────────────
  const [nodeTab, setNodeTab] = useState<NodeTab>(initialTab ?? "summary");
  const [svcTab, setSvcTab] = useState<SvcTab>(initialTab ?? "summary");
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

  // ⌘⇧S → toggle split
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (drawerChord(e) === "split") {
        e.preventDefault();
        toggleSplit();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitKey]);

  useEffect(() => {
    // Fetched for every kind: Node/Service use it for their bespoke summary, and generic
    // kinds use it for the Summary tab (MetadataSummary) added alongside YAML + Events.
    setObjLoading(true);
    api.getObject(cluster, def.gvr, ns, name)
      .then((o) => setObj(o))
      .catch(() => setObj(null))
      .finally(() => setObjLoading(false));
  }, [cluster, def.gvr, ns, name]);

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
      onCloseNow();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setDeleting(false);
    }
  }

  // ── Tab label maps ───────────────────────────────────────────────────────
  const nodeTabLabels: Record<NodeTab, string> = { summary: "Summary", shell: "Terminal", yaml: "YAML" };
  const svcTabLabels: Record<SvcTab, string> = { summary: "Summary", yaml: "YAML" };
  const genTabLabels: Record<GenTab, string> = {
    summary: "Summary",
    rollout: "Rollout",
    timeline: "Timeline",
    autoscaling: "Autoscaling",
    policy: "Policy",
    vulnerabilities: "Vulnerabilities",
    signatures: "Signatures",
    yaml: "YAML",
    events: "Events",
  };
  // Rollout progress for the kinds that roll out revisions (old-vs-new
  // ReplicaSets, or pods per ControllerRevision); Autoscaling only for kinds an HPA/VPA/ScaledObject can
  // target. Policy findings apply to any resource except a PolicyReport
  // itself (findings about findings would be circular). Vulnerabilities
  // (backlog #16 Phase 2) only for the same three kinds right-sizing covers —
  // Trivy-Operator's own resource.kind label only ever resolves to a
  // ReplicaSet/StatefulSet/DaemonSet, matching RIGHTSIZABLE_SLUGS exactly.
  // Every other generic kind keeps the plain three tabs.
  const genTabs: GenTab[] = [
    "summary",
    ...(RIGHTSIZABLE_SLUGS.has(def.slug) ? (["rollout"] as const) : []),
    // Resource Timeline (roadmap Tier 2 #18): the pod-owning workload kinds.
    ...(RIGHTSIZABLE_SLUGS.has(def.slug) ? (["timeline"] as const) : []),
    ...(AUTOSCALABLE_SLUGS.has(def.slug) ? (["autoscaling"] as const) : []),
    ...(def.slug !== "policyreports" && def.slug !== "clusterpolicyreports" ? (["policy"] as const) : []),
    ...(RIGHTSIZABLE_SLUGS.has(def.slug) ? (["vulnerabilities", "signatures"] as const) : []),
    "yaml",
    "events",
  ];

  // ── Shared pane content props ────────────────────────────────────────────
  const sharedContentProps = {
    isNode,
    isService,
    isNamespace,
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
    <Drawer
      title={name}
      copyName={name}
      nameExtra={<ObjectStarButton obj={{ cluster, slug: def.slug, ns, name, kind: def.kind }} />}
      subtitle={def.scoped ? def.label : ns}
      leading={<StatusDot status="connected" />}
      onClose={onClose}
      actions={
        <>
          {!confirming ? (
            <>
              {/* Split view toggle */}
              <IconButton label="Toggle split view" title="Split view (⌘⇧S)" active={split} onClick={toggleSplit}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <rect x="1" y="1" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                  <rect x="8" y="1" width="5" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
                </svg>
              </IconButton>
              <Button
                variant="ghost"
                onClick={() =>
                  useCompare.getState().show({ cluster, gvr: def.gvr, ns: def.scoped ? "" : ns, name, kind: (typeof obj?.kind === "string" && obj.kind) || def.kind })
                }
              >
                Compare with…
              </Button>
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
      {(["deployments", "statefulsets", "daemonsets", "cronjobs", "nodes"].includes(def.slug) || isArgoRollout(def.gvr)) && (
        <ActionsBar
          slug={(isArgoRollout(def.gvr) ? "rollouts" : def.slug) as "deployments"}
          gvr={isArgoRollout(def.gvr) ? def.gvr : undefined}
          cluster={cluster}
          ns={ns}
          name={name}
          gitopsOwner={ownerOf(obj)}
          rollout={isArgoRollout(def.gvr) && obj && typeof obj === "object" ? (obj as Record<string, unknown>) : undefined}
          obj={obj && typeof obj === "object" ? (obj as Record<string, unknown>) : undefined}
          currentReplicas={obj && typeof (obj as Record<string, unknown>).spec === "object"
            ? Number(((obj as Record<string, unknown>).spec as Record<string, unknown>)?.replicas) || 0
            : undefined}
        />
      )}

      {discardModal}

      {/* ── Single-pane tab bar (only when not split) ── */}
      {!split && isNode && (
        <Tabs tabs={["summary", "shell", "yaml"] as const} active={nodeTab} labels={nodeTabLabels} onChange={guardTab(nodeTab, setNodeTab)} />
      )}
      {!split && isService && (
        <Tabs tabs={["summary", "yaml"] as const} active={svcTab} labels={svcTabLabels} onChange={guardTab(svcTab, setSvcTab)} />
      )}
      {!split && !isNode && !isService && (
        <Tabs tabs={genTabs} active={genTab} labels={genTabLabels} onChange={guardTab(genTab, setGenTab)} />
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
                onChange={guardTab(leftNodeTab, setLeftNodeTab)}
              />
            )}
            {isService && (
              <PaneTabs
                tabs={["summary", "yaml"] as const}
                active={leftSvcTab}
                labels={svcTabLabels}
                onChange={guardTab(leftSvcTab, setLeftSvcTab)}
              />
            )}
            {!isNode && !isService && (
              <PaneTabs
                tabs={genTabs}
                active={leftGenTab}
                labels={genTabLabels}
                onChange={guardTab(leftGenTab, setLeftGenTab)}
              />
            )}
            <div className="drawer-pane-body">
              <PaneContent
                {...sharedContentProps}
                nodeTab={leftNodeTab}
                svcTab={leftSvcTab}
                genTab={leftGenTab}
                onGenTab={guardTab(leftGenTab, setLeftGenTab)}
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
                onChange={guardTab(rightNodeTab, setRightNodeTab)}
              />
            )}
            {isService && (
              <PaneTabs
                tabs={["summary", "yaml"] as const}
                active={rightSvcTab}
                labels={svcTabLabels}
                onChange={guardTab(rightSvcTab, setRightSvcTab)}
              />
            )}
            {!isNode && !isService && (
              <PaneTabs
                tabs={genTabs}
                active={rightGenTab}
                labels={genTabLabels}
                onChange={guardTab(rightGenTab, setRightGenTab)}
              />
            )}
            <div className="drawer-pane-body">
              <PaneContent
                {...sharedContentProps}
                nodeTab={rightNodeTab}
                svcTab={rightSvcTab}
                genTab={rightGenTab}
                onGenTab={guardTab(rightGenTab, setRightGenTab)}
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
          genTab={genTab}
          onGenTab={guardTab(genTab, setGenTab)}
        />
      )}
    </Drawer>
  );
}
