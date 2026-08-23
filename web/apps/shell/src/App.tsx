import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes } from "react-router-dom";
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
import ResourceTable from "./pages/ResourceTable";

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
    ],
  },
  {
    label: "Network",
    icon: <IconNetwork />,
    leaves: [
      { to: "/r/services", label: "Services" },
      { to: "/r/ingresses", label: "Ingresses" },
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
    label: "Cluster",
    icon: <IconTopology />,
    leaves: [
      { to: "/r/nodes", label: "Nodes" },
      { to: "/r/namespaces", label: "Namespaces" },
    ],
  },
];

const TOOLS = [
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

function Sidebar({ up }: { up: boolean }) {
  const initialOpen = () => {
    const map: Record<string, boolean> = { Workloads: true };
    for (const g of GROUPS) if (!map[g.label]) map[g.label] = false;
    return map;
  };
  const [open, setOpen] = useState(initialOpen);

  return (
    <aside className="sidebar">
      <div className="brand">
        <svg className="brand-logo" viewBox="0 0 32 32" aria-hidden>
          <defs>
            <linearGradient id="kb-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5b8def" />
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

      <button className="palette-hint">
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
              <span className="chev">▸</span>
            </button>
            <div className="nav-group-items">
              {g.leaves.map((l) => (
                <NavSub key={l.to} leaf={l} />
              ))}
            </div>
          </div>
        ))}

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

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const up = health.data?.ok === true;

  return (
    <div className="app">
      <Sidebar up={up} />

      <main className="content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/fleet" element={<Fleet />} />
          <Route path="/workloads" element={<Workloads />} />
          <Route path="/r/:kind" element={<ResourceTable />} />
          <Route path="/ports" element={<Ports />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/topology" element={<Topology />} />
          <Route path="/rbac" element={<Rbac />} />
          <Route path="/helm" element={<Helm />} />
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
  );
}
