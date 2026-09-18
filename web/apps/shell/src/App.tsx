import { createContext, lazy, Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClusterInfo } from "./lib/api";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useClusterStore } from "./lib/cluster-store";
import { StatusDot } from "@kubebay/ui";
import {
  IconArgoCD,
  IconCube,
  IconDatabase,
  IconForward,
  IconGrid,
  IconHelm,
  IconHome,
  IconNetwork,
  IconSearch,
  IconShield,
  IconSliders,
  IconTimeline,
  IconTopology,
} from "@kubebay/ui/src/icons";
import { api } from "./lib/api";
import Home from "./pages/Home";

// Home stays eager — it is the landing route, so lazying it would only add a
// round-trip before first paint. Everything else is split out: Topology alone
// pulls in @xyflow + d3 (~180 kB) and the pod shell pulls xterm (~330 kB),
// neither of which most sessions ever open.
const loadWorkloads = () => import("./pages/Workloads");
const loadResourceTable = () => import("./pages/ResourceTable");
const Settings = lazy(() => import("./pages/Settings"));
const Workloads = lazy(loadWorkloads);
const Ports = lazy(() => import("./pages/Ports"));
const Timeline = lazy(() => import("./pages/Timeline"));
const Topology = lazy(() => import("./pages/Topology"));
const Rbac = lazy(() => import("./pages/Rbac"));
const Helm = lazy(() => import("./pages/Helm"));
const WorkloadsOverview = lazy(() => import("./pages/WorkloadsOverview"));
const ResourceTable = lazy(loadResourceTable);
const ResourceDetail = lazy(() => import("./pages/ResourceDetail"));
const Crds = lazy(() => import("./pages/Crds"));
const NetworkPolicy = lazy(() => import("./pages/NetworkPolicy"));
const ArgoCD = lazy(() => import("./pages/ArgoCD"));
import { Palette } from "./components/Palette";
import { discoveryApi } from "./lib/api";
import { KNOWN_GVRS, extSlug } from "./lib/resources";
import { FavoritesSidebar, useFavorites } from "./components/Favorites";
import { useClusterIcons, type ClusterIcon } from "./lib/useClusterIcons";
import { useWsStatus } from "./lib/useWsStatus";
import { clearStreamCacheForCluster } from "./lib/streamCache";
import { ErrorBoundary } from "./components/ErrorBoundary";

// ──── Cluster Context ────────────────────────────────────────────────────────
// `active` and `setActive` now live in Zustand (cluster-store.ts).
// ClusterCtx only carries UI-only `switching` state.

const ClusterCtx = createContext<{ switching: boolean; setActive: (id: string) => void }>({
  switching: false,
  setActive: () => {},
});

export function useActiveCluster() {
  const { active, setActive } = useClusterStore();
  const { switching } = useContext(ClusterCtx);
  return { active, setActive, switching };
}

// ──── Nav types ──────────────────────────────────────────────────────────────

interface NavLeaf {
  to: string;
  label: string;
}
interface NavGroupDef {
  label: string;
  icon: JSX.Element;
  leaves: NavLeaf[];
}

const GROUPS: NavGroupDef[] = [
  {
    label: "Workloads",
    icon: <IconCube />,
    leaves: [
      { to: "/workloads-overview", label: "Overview" },
      { to: "/workloads", label: "Pods" },
      { to: "/r/deployments", label: "Deployments" },
      { to: "/r/replicasets", label: "ReplicaSets" },
      { to: "/r/statefulsets", label: "StatefulSets" },
      { to: "/r/daemonsets", label: "DaemonSets" },
      { to: "/r/jobs", label: "Jobs" },
      { to: "/r/cronjobs", label: "CronJobs" },
      { to: "/r/replicationcontrollers", label: "ReplicationControllers" },
      { to: "/r/controllerrevisions", label: "ControllerRevisions" },
    ],
  },
  {
    label: "Configuration",
    icon: <IconSliders />,
    leaves: [
      { to: "/r/configmaps", label: "ConfigMaps" },
      { to: "/r/secrets", label: "Secrets" },
      { to: "/r/resourcequotas", label: "ResourceQuotas" },
      { to: "/r/limitranges", label: "LimitRanges" },
      { to: "/r/horizontalpodautoscalers", label: "HPAs" },
      { to: "/r/poddisruptionbudgets", label: "PDBs" },
      { to: "/r/priorityclasses", label: "PriorityClasses" },
    ],
  },
  {
    label: "Network",
    icon: <IconNetwork />,
    leaves: [
      { to: "/r/services", label: "Services" },
      { to: "/r/endpoints", label: "Endpoints" },
      { to: "/r/endpointslices", label: "EndpointSlices" },
      { to: "/r/ingresses", label: "Ingresses" },
      { to: "/r/ingressclasses", label: "IngressClasses" },
      { to: "/network-policy", label: "NetworkPolicies" },
    ],
  },
  {
    label: "Storage",
    icon: <IconDatabase />,
    leaves: [
      { to: "/r/persistentvolumeclaims", label: "PVCs" },
      { to: "/r/persistentvolumes", label: "PVs" },
      { to: "/r/storageclasses", label: "StorageClasses" },
      { to: "/r/volumeattachments", label: "VolumeAttachments" },
      { to: "/r/csidrivers", label: "CSI Drivers" },
      { to: "/r/csinodes", label: "CSI Nodes" },
      { to: "/r/csistoragecapacities", label: "CSI Capacities" },
    ],
  },
  {
    label: "Access Control",
    icon: <IconShield />,
    leaves: [
      { to: "/r/serviceaccounts", label: "ServiceAccounts" },
      { to: "/r/roles", label: "Roles" },
      { to: "/r/clusterroles", label: "ClusterRoles" },
      { to: "/r/rolebindings", label: "RoleBindings" },
      { to: "/r/clusterrolebindings", label: "ClusterRoleBindings" },
    ],
  },
  {
    label: "Admission",
    icon: <IconShield />,
    leaves: [
      { to: "/r/mutatingwebhookconfigurations", label: "Mutating Webhooks" },
      { to: "/r/validatingwebhookconfigurations", label: "Validating Webhooks" },
      { to: "/r/validatingadmissionpolicies", label: "Admission Policies" },
      { to: "/r/validatingadmissionpolicybindings", label: "Policy Bindings" },
    ],
  },
  {
    label: "Cluster",
    icon: <IconTopology />,
    leaves: [
      { to: "/r/nodes", label: "Nodes" },
      { to: "/r/namespaces", label: "Namespaces" },
      { to: "/r/events", label: "Events" },
      { to: "/r/runtimeclasses", label: "RuntimeClasses" },
      { to: "/r/leases", label: "Leases" },
      { to: "/r/certificatesigningrequests", label: "CertSigningRequests" },
      { to: "/r/apiservices", label: "API Services" },
      { to: "/r/flowschemas", label: "FlowSchemas" },
      { to: "/r/prioritylevelconfigurations", label: "Priority Levels" },
    ],
  },
];

const TOOLS = [
  { to: "/crds", label: "CRDs", icon: <IconGrid /> },
  { to: "/ports", label: "Ports", icon: <IconForward /> },
  { to: "/helm", label: "Helm", icon: <IconHelm /> },
  { to: "/argocd", label: "ArgoCD", icon: <IconArgoCD /> },
  { to: "/rbac", label: "RBAC", icon: <IconShield /> },
  { to: "/timeline", label: "Timeline", icon: <IconTimeline /> },
  { to: "/topology", label: "Topology", icon: <IconTopology /> },
  { to: "/settings", label: "Settings", icon: <IconSliders /> },
];

function NavSub({ leaf }: { leaf: NavLeaf }) {
  return (
    <NavLink to={leaf.to} className={({ isActive }) => (isActive ? "nav-item sub active" : "nav-item sub")}>
      {leaf.label}
    </NavLink>
  );
}

function CustomResourcesGroup() {
  const queryClient = useQueryClient();
  const clusterListCRG = queryClient.getQueryData<ClusterInfo[]>(["clusters"]) ?? [];
  const cluster = clusterListCRG.find((c) => c.status === "connected")?.id ?? "";
  const disc = useQuery({
    queryKey: ["apis", cluster],
    queryFn: () => discoveryApi.apis(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000, // API resource list changes only on CRD install/remove
    retry: false,
  });
  const [open, setOpen] = useState(false);
  const items = useMemo(
    () => (disc.data ?? []).filter((e) => e.group !== "" && !KNOWN_GVRS.has(e.gvr)).slice(0, 40),
    [disc.data],
  );
  if (!items.length) return null;
  return (
    <div className={`nav-group${open ? " open" : ""}`}>
      <button className="nav-group-title" onClick={() => setOpen((o) => !o)}>
        <span className="nav-icon"><IconCube /></span>
        <span>Custom Resources</span>
        <span className="chev" style={{ marginLeft: "auto" }}>▸</span>
      </button>
      <div className="nav-group-items">
        {items.map((e) => (
          <NavLink
            key={e.gvr}
            to={`/r/ext--${extSlug(e.gvr)}?scoped=${e.namespaced ? 1 : 0}`}
            className={({ isActive }) => (isActive ? "nav-item sub active" : "nav-item sub")}
          >
            {e.kind}
          </NavLink>
        ))}
      </div>
    </div>
  );
}

// ──── ClusterStrip ───────────────────────────────────────────────────────────

const ICON_PRESETS = [
  { bg: "#F90",     label: "AWS" },
  { bg: "#4285F4",  label: "GCP" },
  { bg: "#0078D4",  label: "AZ"  },
  { bg: "#7C3AED",  label: "K"   },
  { bg: "#326CE5",  label: "M"   },
  { bg: "#41c98e",  label: "DEV" },
  { bg: "#ef5f68",  label: "PRD" },
  { bg: "#64748b",  label: "STG" },
];

function autoAvatar(id: string): { bg: string; label: string } {
  if (id.startsWith("arn:aws")) return { bg: "#F90", label: "AWS" };
  if (id.includes("gke") || id.includes("gcp")) return { bg: "#4285F4", label: "GCP" };
  if (id.includes("aks") || id.includes("azure")) return { bg: "#0078D4", label: "AZ" };
  if (id.startsWith("kind-")) return { bg: "#7C3AED", label: "K" };
  if (id.startsWith("minikube")) return { bg: "#326CE5", label: "M" };
  return { bg: "var(--kb-accent)", label: id.slice(0, 2).toUpperCase() };
}

interface IconPickerProps {
  clusterId: string;
  current: ClusterIcon;
  onSave: (icon: ClusterIcon) => void;
  onReset: () => void;
  onClose: () => void;
}

function ClusterIconPicker({ clusterId, current, onSave, onReset, onClose }: IconPickerProps) {
  const [bg, setBg] = useState(current.bg);
  const [label, setLabel] = useState(current.label);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="icon-picker-backdrop" onClick={onClose} />
      <div className="icon-picker">
        <div className="icon-picker-title">Customize icon</div>
        <div className="icon-picker-preview" style={{ background: bg }}>
          {label || "?"}
        </div>
        <div className="icon-picker-section">Colors</div>
        <div className="icon-picker-swatches">
          {ICON_PRESETS.map((p) => (
            <button
              key={p.bg}
              className={`icon-swatch${bg === p.bg ? " selected" : ""}`}
              style={{ background: p.bg }}
              onClick={() => { setBg(p.bg); setLabel(p.label); }}
              title={p.label}
            />
          ))}
          <label className="icon-swatch icon-swatch-custom" title="Custom color">
            <input
              type="color"
              value={bg.startsWith("#") ? bg : "#41c98e"}
              onChange={(e) => setBg(e.target.value)}
              style={{ opacity: 0, position: "absolute", inset: 0, width: "100%", height: "100%", cursor: "pointer" }}
            />
            <span style={{ fontSize: "var(--kb-text-lg)" }}>🎨</span>
          </label>
        </div>
        <div className="icon-picker-section">Label</div>
        <input
          className="icon-picker-input"
          maxLength={3}
          value={label}
          onChange={(e) => setLabel(e.target.value.toUpperCase())}
          placeholder={clusterId.slice(0, 3).toUpperCase()}
          spellCheck={false}
        />
        <div className="icon-picker-actions">
          <button className="icon-picker-btn ghost" onClick={() => { onReset(); onClose(); }}>
            Reset
          </button>
          <button className="icon-picker-btn primary" onClick={() => { onSave({ bg, label }); onClose(); }}>
            Apply
          </button>
        </div>
      </div>
    </>
  );
}

// ──── ClusterConnectingOverlay ────────────────────────────────────────────────

interface OverlayProps {
  clusterId: string;
  clusterStatus: string;
  clusterError?: string;
  clusterVersion?: string;
  wsConnected: boolean;
  wsRetry: number;
  wsNextRetryMs: number;
  isReconnect: boolean; // true = WS dropped, false = cluster switch
  avatar: { bg: string; label: string };
}

function ClusterConnectingOverlay({
  clusterId,
  clusterStatus,
  clusterError,
  clusterVersion,
  wsConnected,
  wsRetry,
  wsNextRetryMs,
  isReconnect,
  avatar,
}: OverlayProps) {
  const [countdown, setCountdown] = useState(Math.ceil(wsNextRetryMs / 1000));

  useEffect(() => {
    if (wsConnected || wsNextRetryMs <= 0) return;
    setCountdown(Math.ceil(wsNextRetryMs / 1000));
    const interval = setInterval(() => {
      setCountdown((n) => Math.max(0, n - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [wsNextRetryMs, wsConnected]);

  // Steps: 0=Auth/Credentials  1=API Server  2=Live Stream
  // For WS reconnect the steps are: 0=Disconnected  1=Reconnecting  2=Restored
  const steps = isReconnect
    ? ["Disconnected", "Reconnecting", "Restored"]
    : ["Credentials", "API Server", "Live Stream"];

  // Current step index
  let currentStep = 0;
  if (isReconnect) {
    if (wsConnected) currentStep = 2;
    else if (wsRetry > 0) currentStep = 1;
    else currentStep = 0;
  } else {
    if (clusterStatus === "connected" && wsConnected) currentStep = 2;
    else if (clusterStatus === "connected") currentStep = 1;
    else currentStep = 0;
  }

  // Status message shown under the steps
  let statusMsg = "";
  let isError = false;
  if (isReconnect) {
    if (wsConnected) {
      statusMsg = "Stream restored — reloading data…";
    } else if (wsRetry > 0) {
      statusMsg = `Attempt ${wsRetry} · retrying in ${countdown}s`;
    } else {
      statusMsg = "Connection lost — reconnecting…";
    }
  } else {
    if (clusterStatus === "connected" && wsConnected) {
      statusMsg = clusterVersion ? `Connected · ${clusterVersion}` : "Connected";
    } else if (clusterStatus === "connected") {
      statusMsg = "API reachable · opening live stream…";
    } else if (clusterError) {
      statusMsg = clusterError;
      isError = true;
    } else {
      statusMsg = "Checking cluster credentials…";
    }
  }

  return (
    <div className="conn-overlay">
      <div className="conn-card">
        {/* Avatar */}
        <div className="conn-avatar" style={{ background: avatar.bg }}>
          {avatar.label}
        </div>
        <div className="conn-cluster-name">{clusterId}</div>

        {/* Stepper */}
        <div className="conn-stepper">
          {steps.map((label, i) => {
            const done = i < currentStep;
            const active = i === currentStep;
            return (
              <div key={label} className="conn-step-item">
                <div className={`conn-step-dot${done ? " done" : active ? " active" : ""}`}>
                  {done ? (
                    <svg viewBox="0 0 10 10" width="10" height="10" fill="none">
                      <polyline points="2,5 4.5,7.5 8,3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  ) : active ? (
                    <span className="conn-pulse" />
                  ) : null}
                </div>
                {i < steps.length - 1 && (
                  <div className={`conn-step-line${done ? " done" : ""}`} />
                )}
                <div className={`conn-step-label${active ? " active" : done ? " done" : ""}`}>
                  {label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Status message */}
        <div className={`conn-status-msg${isError ? " error" : ""}`}>
          {isError && (
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
          {statusMsg}
        </div>

        {/* Retry hint for WS reconnect */}
        {isReconnect && !wsConnected && wsRetry > 0 && (
          <div className="conn-retry-bar">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="none" style={{ animation: "spin 1.4s linear infinite", flexShrink: 0 }}>
              <path d="M8 2a6 6 0 0 1 5.66 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M13.66 10 l-2 2 2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>WebSocket reconnecting</span>
          </div>
        )}

        {/* Error detail hint */}
        {isError && (
          <div className="conn-error-hint">
            Check that the cluster API server is reachable and credentials are valid.
          </div>
        )}
      </div>
    </div>
  );
}

function ClusterStrip() {
  const { active } = useClusterStore();
  const { switching, setActive } = useContext(ClusterCtx);
  const queryClient = useQueryClient();
  const list = queryClient.getQueryData<ClusterInfo[]>(["clusters"]) ?? [];
  const effectiveActive = active || list.find((c) => c.status === "connected")?.id || "";
  const { icons, setIcon, resetIcon } = useClusterIcons();
  const [picker, setPicker] = useState<string | null>(null);

  return (
    <div className="cluster-strip">
      {/* Kubebay mini logo at top */}
      <svg className="cluster-strip-logo" viewBox="0 0 32 32" aria-hidden>
        <defs>
          <linearGradient id="ks-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#41c98e" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill="url(#ks-g)" />
        <circle cx="16" cy="14.5" r="5.4" fill="none" stroke="#fff" strokeWidth="2" />
        <path d="M7.5 22.5c2.6 2.3 5.4 3.4 8.5 3.4s5.9-1.1 8.5-3.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <path d="M16 9v11M10 13.5h12" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
      </svg>
      {list.map((c) => {
        const auto = autoAvatar(c.id);
        const { bg, label } = icons[c.id] ?? auto;
        const broken = c.status === "misconfigured";
        const isActive = !broken && c.id === effectiveActive;
        const isSwitching = isActive && switching;
        return (
          <button
            key={c.id}
            disabled={broken}
            title={broken ? `${c.id} — can't be loaded: ${c.error ?? "unknown error"}` : `${c.id} — right-click to customize icon`}
            onClick={() => { if (!broken) setActive(c.id); }}
            onContextMenu={(e) => { e.preventDefault(); setPicker(c.id); }}
            style={{
              position: "relative",
              width: 40,
              height: 40,
              borderRadius: "var(--kb-radius)",
              background: bg,
              color: "#fff",
              fontWeight: 700,
              fontSize: "var(--kb-text-xs)",
              border: isActive ? "2px solid rgba(255,255,255,0.9)" : "2px solid transparent",
              opacity: broken ? 0.28 : isActive ? 1 : 0.5,
              cursor: broken ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              transition: "opacity 150ms, border-color 150ms, box-shadow 150ms",
              boxShadow: isActive ? `0 0 0 2px ${bg.startsWith("#") ? bg : "var(--kb-accent)"}44` : "none",
              fontFamily: "var(--kb-font-mono, monospace)",
              letterSpacing: "-0.02em",
              overflow: "hidden",
            }}
          >
            {isSwitching ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin 0.8s linear infinite" }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : label}
            {/* Status dot */}
            <span style={{
              position: "absolute",
              bottom: -2,
              right: -2,
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: c.status === "connected" ? "var(--kb-status-ok)" : broken ? "var(--kb-fg-subtle)" : "var(--kb-status-err)",
              border: "2px solid var(--kb-bg-sidebar)",
            }} />
          </button>
        );
      })}

      {picker && (() => {
        const auto = autoAvatar(picker);
        const current = icons[picker] ?? auto;
        return (
          <ClusterIconPicker
            clusterId={picker}
            current={current}
            onSave={(icon) => setIcon(picker, icon)}
            onReset={() => resetIcon(picker)}
            onClose={() => setPicker(null)}
          />
        );
      })()}
    </div>
  );
}

// ──── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const initialOpen = () => {
    const map: Record<string, boolean> = { Workloads: true };
    for (const g of GROUPS) if (!map[g.label]) map[g.label] = false;
    return map;
  };
  const [open, setOpen] = useState(initialOpen);
  const { favorites, remove: removeFav } = useFavorites();
  const { active } = useClusterStore();
  const queryClient = useQueryClient();
  const clusterList = queryClient.getQueryData<ClusterInfo[]>(["clusters"]) ?? [];
  const usableClusters = clusterList.filter((c) => c.status !== "misconfigured");
  const effectiveActive = active || usableClusters.find((c) => c.status === "connected")?.id || usableClusters[0]?.id || "";
  const activeCluster = clusterList.find((c) => c.id === effectiveActive);

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden>
          <defs>
            <linearGradient id="kb-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="100%" stopColor="#41c98e" />
            </linearGradient>
          </defs>
          <rect width="32" height="32" rx="9" fill="url(#kb-g)" />
          <circle cx="16" cy="14.5" r="5.4" fill="none" stroke="#fff" strokeWidth="2" />
          <path d="M7.5 22.5c2.6 2.3 5.4 3.4 8.5 3.4s5.9-1.1 8.5-3.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          <path d="M16 9v11M10 13.5h12" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" />
        </svg>
        <div className="brand-info">
          <span className="brand-name">Kubebay</span>
          {activeCluster && (
            <span className="brand-cluster" title={activeCluster.id}>
              <StatusDot status={activeCluster.status === "connected" ? "connected" : activeCluster.status === "unreachable" ? "unreachable" : "pending"} />
              <span className="brand-cluster-name">{activeCluster.id}</span>
            </span>
          )}
        </div>
      </div>

      <button className="palette-hint" onClick={onOpenPalette}>
        <IconSearch size={13} />
        <span>Search…</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="nav">
        <div className="nav-section">Navigate</div>
        <NavLink to="/" end className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          <span className="nav-icon"><IconHome /></span>
          <span>Home</span>
        </NavLink>

        {GROUPS.map((g) => (
          <div key={g.label} className={`nav-group${open[g.label] ? " open" : ""}`}>
            <button
              className="nav-group-title"
              onClick={() => setOpen((o) => ({ ...o, [g.label]: !o[g.label] }))}
            >
              <span className="nav-icon">{g.icon}</span>
              <span>{g.label}</span>
              <span className="chev" style={{ marginLeft: "auto" }}>▸</span>
            </button>
            <div className="nav-group-items">
              {g.leaves.map((l) => (
                <NavSub key={l.to} leaf={l} />
              ))}
            </div>
          </div>
        ))}

        <CustomResourcesGroup />

        {favorites.length > 0 && <FavoritesSidebar favorites={favorites} onRemove={removeFav} />}

        <div className="nav-section">Tools</div>
        {TOOLS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
            <span className="nav-icon">{t.icon}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>

    </aside>
  );
}

// ──── NotFound ───────────────────────────────────────────────────────────────
// Catches stale/dead links (e.g. a favorited route removed in a later version)
// so an unmatched path shows a recoverable message instead of a silent blank
// content pane — Routes with no matching Route and no wildcard renders nothing.

function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <div className="empty-state">
        <p>This page doesn't exist.</p>
        <p className="muted small">The link may be out of date — try Home or search with ⌘K.</p>
        <button className="ns-clear" style={{ marginTop: 12 }} onClick={() => navigate("/")}>
          Go home
        </button>
      </div>
    </div>
  );
}

// ──── App ────────────────────────────────────────────────────────────────────

function AppInner() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 4_000 });
  const up = health.data?.ok === true;
  const ws = useWsStatus();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [active, setActiveState] = useState<string>(
    () => new URLSearchParams(window.location.search).get("cluster") ?? "",
  );

  const list = clusters.data ?? [];
  const effectiveActive = active || list.find((c) => c.status === "connected")?.id || list[0]?.id || "";
  const activeCluster = list.find((c) => c.id === effectiveActive);

  const setActive = (id: string) => {
    if (id !== effectiveActive) {
      setSwitching(true);
      // Safety: never block the UI longer than 15s
      if (safetyTimer.current) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => setSwitching(false), 15_000);
      // Background-revalidate all active queries for the new cluster so stale
      // data gets refreshed without blocking the UI (cached data shows instantly).
      queryClient.invalidateQueries({ queryKey: [id], refetchType: "active" });
      // Clear stream cache for the old cluster so stale WS rows are not shown.
      clearStreamCacheForCluster(effectiveActive);
    }
    setActiveState(id);
    useClusterStore.getState().setActive(id);
    const sp = new URLSearchParams(window.location.search);
    sp.set("cluster", id);
    navigate({ search: sp.toString() }, { replace: true });
  };

  // Dismiss the switching overlay once the cluster is reachable + stream is up
  useEffect(() => {
    if (!switching) return;
    if (activeCluster?.status === "connected" && ws.connected) {
      const t = setTimeout(() => setSwitching(false), 400);
      return () => clearTimeout(t);
    }
  }, [switching, activeCluster?.status, ws.connected]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Show overlay when: actively switching cluster, or WS dropped after first connect
  const showSwitchOverlay = switching;
  const showReconnectOverlay = ws.hasEverConnected && !ws.connected && !switching;
  const showOverlay = showSwitchOverlay || showReconnectOverlay;

  const overlayAvatar = activeCluster
    ? ((() => {
        const auto = autoAvatar(activeCluster.id);
        return auto; // icon picker state lives in ClusterStrip; use auto for overlay
      })())
    : { bg: "var(--kb-accent)", label: "…" };

  return (
    <ClusterCtx.Provider value={{ switching, setActive }}>
      <div className="app">
        <ClusterStrip />
        <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
        <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

        <main className="content">
          <ErrorBoundary resetKey={location.pathname}>
            {/* Empty page shell, not a spinner: chunks resolve in a few ms on
                local disk and a spinner would flash more than it informs. */}
            <Suspense fallback={<div className="page" />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/workloads" element={<Workloads />} />
              <Route path="/workloads-overview" element={<WorkloadsOverview />} />
              <Route path="/r/:kind" element={<ResourceTable />} />
              <Route path="/detail/:kind/:ns/:name" element={<ResourceDetail />} />
              <Route path="/ports" element={<Ports />} />
              <Route path="/timeline" element={<Timeline />} />
              <Route path="/topology" element={<Topology />} />
              <Route path="/rbac" element={<Rbac />} />
              <Route path="/helm" element={<Helm />} />
              <Route path="/argocd" element={<ArgoCD />} />
              <Route path="/crds" element={<Crds />} />
              <Route path="/network-policy" element={<NetworkPolicy />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
          </ErrorBoundary>

          {showOverlay && (
            <ClusterConnectingOverlay
              key={showReconnectOverlay ? "reconnect" : effectiveActive}
              clusterId={effectiveActive || "Connecting…"}
              clusterStatus={activeCluster?.status ?? "unreachable"}
              clusterError={activeCluster?.error}
              clusterVersion={activeCluster?.version}
              wsConnected={ws.connected}
              wsRetry={ws.retryAttempt}
              wsNextRetryMs={ws.nextRetryMs}
              isReconnect={showReconnectOverlay}
              avatar={overlayAvatar}
            />
          )}
        </main>

        <footer className="statusbar">
          <span className="statusbar-left">
            <StatusDot status={up ? "connected" : "unreachable"} />
            <span>kubebay-engine</span>
            <span className="muted">{up ? "listening" : "reconnecting…"}</span>
          </span>
          {!ws.connected && ws.hasEverConnected && (
            <span className="statusbar-center muted" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" style={{ animation: "spin 1.4s linear infinite" }}>
                <path d="M8 2a6 6 0 0 1 5.66 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              WS reconnecting · attempt {ws.retryAttempt}
            </span>
          )}
          <span className="statusbar-right muted">
            <kbd>⌘K</kbd> palette
          </span>
        </footer>
      </div>
    </ClusterCtx.Provider>
  );
}

export default function App() {
  // Warm the two routes users almost always reach from Home, once the main
  // thread is idle, so splitting them out never costs a visible fallback.
  useEffect(() => {
    const warm = () => {
      void loadResourceTable();
      void loadWorkloads();
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) {
      ric(warm);
      return;
    }
    const t = setTimeout(warm, 1500);
    return () => clearTimeout(t);
  }, []);

  return <AppInner />;
}
