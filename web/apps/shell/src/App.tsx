import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { StatusDot } from "@kubebay/ui";
import {
  IconCube,
  IconDatabase,
  IconForward,
  IconGrid,
  IconHelm,
  IconLayers,
  IconNetwork,
  IconSearch,
  IconShield,
  IconSliders,
  IconTimeline,
  IconTopology,
} from "@kubebay/ui/src/icons";
import { api } from "./lib/api";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import Workloads from "./pages/Workloads";
import Ports from "./pages/Ports";
import Timeline from "./pages/Timeline";
import Topology from "./pages/Topology";
import Rbac from "./pages/Rbac";
import Helm from "./pages/Helm";
import Fleet from "./pages/Fleet";
import WorkloadsOverview from "./pages/WorkloadsOverview";
import ResourceTable from "./pages/ResourceTable";
import Crds from "./pages/Crds";
import { Palette } from "./components/Palette";
import { discoveryApi } from "./lib/api";
import { KNOWN_GVRS, extSlug } from "./lib/resources";
import { FavoritesSidebar, useFavorites } from "./components/Favorites";

// ──── Cluster Context ────────────────────────────────────────────────────────

const ClusterCtx = createContext<{ active: string; setActive: (id: string) => void }>({
  active: "",
  setActive: () => {},
});

export const useActiveCluster = () => useContext(ClusterCtx);

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
      { to: "/r/networkpolicies", label: "NetworkPolicies" },
    ],
  },
  {
    label: "Storage",
    icon: <IconDatabase />,
    leaves: [
      { to: "/r/persistentvolumeclaims", label: "PVCs" },
      { to: "/r/persistentvolumes", label: "PVs" },
      { to: "/r/storageclasses", label: "StorageClasses" },
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
    label: "Cluster",
    icon: <IconTopology />,
    leaves: [
      { to: "/r/nodes", label: "Nodes" },
      { to: "/r/namespaces", label: "Namespaces" },
    ],
  },
];

const TOOLS = [
  { to: "/crds", label: "CRDs", icon: <IconGrid /> },
  { to: "/ports", label: "Ports", icon: <IconForward /> },
  { to: "/helm", label: "Helm", icon: <IconHelm /> },
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
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const cluster = (clusters.data ?? []).find((c) => c.status === "connected")?.id ?? "";
  const disc = useQuery({
    queryKey: ["apis", cluster],
    queryFn: () => discoveryApi.apis(cluster),
    enabled: !!cluster,
    staleTime: 60_000,
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

function clusterAvatar(id: string): { bg: string; label: string } {
  if (id.startsWith("arn:aws")) return { bg: "#F90", label: "AWS" };
  if (id.includes("gke") || id.includes("gcp")) return { bg: "#4285F4", label: "GCP" };
  if (id.includes("aks") || id.includes("azure")) return { bg: "#0078D4", label: "AZ" };
  if (id.startsWith("kind-")) return { bg: "#7C3AED", label: "K" };
  if (id.startsWith("minikube")) return { bg: "#326CE5", label: "M" };
  return { bg: "var(--kb-accent)", label: id.slice(0, 2).toUpperCase() };
}

function ClusterStrip() {
  const { active, setActive } = useActiveCluster();
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, refetchInterval: 4_000 });
  const list = clusters.data ?? [];
  const effectiveActive = active || list.find((c) => c.status === "connected")?.id || "";

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
        const { bg, label } = clusterAvatar(c.id);
        const isActive = c.id === effectiveActive;
        const isConnecting = c.id === active && c.status !== "connected";
        return (
          <button
            key={c.id}
            title={`${c.id}${isConnecting ? " (connecting…)" : c.status === "connected" ? " ✓" : " ✗"}`}
            onClick={() => setActive(c.id)}
            style={{
              position: "relative",
              width: 40,
              height: 40,
              borderRadius: 10,
              background: bg,
              color: "#fff",
              fontWeight: 700,
              fontSize: 11,
              border: isActive ? "2px solid rgba(255,255,255,0.9)" : "2px solid transparent",
              opacity: isActive ? 1 : 0.5,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              flexShrink: 0,
              transition: "opacity 150ms, border-color 150ms, box-shadow 150ms",
              boxShadow: isActive ? `0 0 0 2px ${bg === "var(--kb-accent)" ? "var(--kb-accent)" : bg}44` : "none",
              fontFamily: "var(--kb-font-mono, monospace)",
              letterSpacing: "-0.02em",
            }}
          >
            {isConnecting ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" strokeWidth="2.5" style={{ animation: "spin 1s linear infinite" }}>
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
              background: c.status === "connected" ? "var(--kb-status-ok)" : "var(--kb-status-err)",
              border: "2px solid var(--kb-bg-sidebar)",
            }} />
          </button>
        );
      })}
    </div>
  );
}

// ──── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({ up, onOpenPalette }: { up: boolean; onOpenPalette: () => void }) {
  const initialOpen = () => {
    const map: Record<string, boolean> = { Workloads: true };
    for (const g of GROUPS) if (!map[g.label]) map[g.label] = false;
    return map;
  };
  const [open, setOpen] = useState(initialOpen);
  const { favorites, remove: removeFav } = useFavorites();

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
        <span>Kubebay</span>
      </div>

      <button className="palette-hint" onClick={onOpenPalette}>
        <IconSearch size={13} />
        <span>Search…</span>
        <kbd>⌘K</kbd>
      </button>

      <nav className="nav">
        <div className="nav-section">Navigate</div>
        <NavLink to="/" end className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          <span className="nav-icon"><IconGrid /></span>
          <span>Overview</span>
        </NavLink>
        <NavLink to="/fleet" className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
          <span className="nav-icon"><IconLayers /></span>
          <span>Fleet</span>
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

      <div className="sidebar-footer">
        <StatusDot status={up ? "connected" : "unreachable"} pulse={!up} />
        <span className="small">{up ? "engine connected" : "engine offline"}</span>
      </div>
    </aside>
  );
}

// ──── App ────────────────────────────────────────────────────────────────────

function AppInner() {
  const navigate = useNavigate();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const up = health.data?.ok === true;
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [active, setActiveState] = useState<string>(
    () => new URLSearchParams(window.location.search).get("cluster") ?? "",
  );

  const setActive = (id: string) => {
    setActiveState(id);
    const sp = new URLSearchParams(window.location.search);
    sp.set("cluster", id);
    navigate({ search: sp.toString() }, { replace: true });
  };

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

  return (
    <ClusterCtx.Provider value={{ active, setActive }}>
      <div className="app">
        <ClusterStrip />
        <Sidebar up={up} onOpenPalette={() => setPaletteOpen(true)} />
        <Palette open={paletteOpen} onClose={() => setPaletteOpen(false)} />

        <main className="content">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/workloads" element={<Workloads />} />
            <Route path="/workloads-overview" element={<WorkloadsOverview />} />
            <Route path="/r/:kind" element={<ResourceTable />} />
            <Route path="/ports" element={<Ports />} />
            <Route path="/timeline" element={<Timeline />} />
            <Route path="/topology" element={<Topology />} />
            <Route path="/rbac" element={<Rbac />} />
            <Route path="/helm" element={<Helm />} />
            <Route path="/crds" element={<Crds />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>

        <footer className="statusbar">
          <span className="statusbar-left">
            <StatusDot status={up ? "connected" : "unreachable"} />
            <span>kubebay-engine</span>
            <span className="muted">{up ? "listening" : "reconnecting…"}</span>
          </span>
          <span className="statusbar-right muted">
            <kbd>⌘K</kbd> palette
          </span>
        </footer>
      </div>
    </ClusterCtx.Provider>
  );
}

export default function App() {
  return <AppInner />;
}
