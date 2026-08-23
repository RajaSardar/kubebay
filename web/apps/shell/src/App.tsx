import { useQuery } from "@tanstack/react-query";
import { NavLink, Route, Routes } from "react-router-dom";
import { Badge, StatusDot } from "@kubebay/ui";
import { IconCube, IconForward, IconGrid, IconHelm, IconSearch, IconShield, IconSliders, IconTimeline, IconTopology } from "@kubebay/ui/src/icons";
import { api } from "./lib/api";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import Workloads from "./pages/Workloads";
import Ports from "./pages/Ports";
import Timeline from "./pages/Timeline";
import Topology from "./pages/Topology";
import Rbac from "./pages/Rbac";

const NAV_MAIN = [
  { to: "/", label: "Overview", icon: <IconGrid /> },
  { to: "/workloads", label: "Workloads", icon: <IconCube /> },
  { to: "/timeline", label: "Timeline", icon: <IconTimeline /> },
  { to: "/topology", label: "Topology", icon: <IconTopology /> },
];

const NAV_TOOLS = [
  { to: "/ports", label: "Ports", icon: <IconForward /> },
  { to: "/rbac", label: "RBAC", icon: <IconShield /> },
  { to: "/helm", label: "Helm", icon: <IconHelm />, soon: true },
  { to: "/settings", label: "Settings", icon: <IconSliders /> },
];

type NavItemDef = { to: string; label: string; icon: JSX.Element; soon?: boolean };

function NavItem({ item }: { item: NavItemDef }) {
  return (
    <NavLink to={item.to} className={({ isActive }) => (isActive ? "nav-item active" : "nav-item")}>
      <span className="nav-icon">{item.icon}</span>
      <span>{item.label}</span>
      {item.soon && <span className="nav-soon">soon</span>}
    </NavLink>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h2>{title}</h2>
        <Badge>phase 1</Badge>
      </div>
      <div className="empty-state">
        <p>This surface arrives in a later Phase 0 milestone.</p>
        <p className="muted small">The engine is streaming-ready — UI lands next.</p>
      </div>
    </div>
  );
}

export default function App() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 10_000 });
  const up = health.data?.ok === true;

  return (
    <div className="app">
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
          {NAV_MAIN.map((i) => (
            <NavItem key={i.to} item={i} />
          ))}
          <div className="nav-section">Tools</div>
          {NAV_TOOLS.map((i) => (
            <NavItem key={i.to} item={i} />
          ))}
        </nav>

        <div className="sidebar-footer">
          <StatusDot status={up ? "connected" : "unreachable"} pulse={!up} />
          <span className="small">{up ? "engine connected" : "engine offline"}</span>
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/workloads" element={<Workloads />} />
          <Route path="/ports" element={<Ports />} />
          <Route path="/timeline" element={<Timeline />} />
          <Route path="/topology" element={<Topology />} />
          <Route path="/rbac" element={<Rbac />} />
          <Route path="/helm" element={<Placeholder title="Helm manager" />} />
        </Routes>
      </main>

      <footer className="statusbar">
        <span className="statusbar-left">
          <StatusDot status={up ? "connected" : "unreachable"} />
          <span>kubebay-engine</span>
          <span className="muted">{up ? "listening · 127.0.0.1" : "reconnecting…"}</span>
        </span>
        <span className="statusbar-right muted">
          <kbd>⌘K</kbd> palette
        </span>
      </footer>
    </div>
  );
}
