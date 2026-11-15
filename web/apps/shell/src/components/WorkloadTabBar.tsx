import { NavLink, useSearchParams } from "react-router-dom";

const WORKLOAD_TABS = [
  { label: "Overview",                to: "/workloads-overview" },
  { label: "Pods",                    to: "/workloads" },
  { label: "Deployments",             to: "/r/deployments" },
  { label: "Daemon Sets",             to: "/r/daemonsets" },
  { label: "Stateful Sets",           to: "/r/statefulsets" },
  { label: "Replica Sets",            to: "/r/replicasets" },
  { label: "Jobs",                    to: "/r/jobs" },
  { label: "Cron Jobs",               to: "/r/cronjobs" },
  { label: "Replication Controllers", to: "/r/replicationcontrollers" },
];

const WORKLOAD_ROUTES = new Set(WORKLOAD_TABS.map((t) => t.to));

export function isWorkloadRoute(pathname: string): boolean {
  return WORKLOAD_ROUTES.has(pathname.split("?")[0] ?? "");
}

export function WorkloadTabBar() {
  const [sp] = useSearchParams();
  const cluster = sp.get("cluster") ?? "";

  return (
    <div className="workload-tab-bar">
      {WORKLOAD_TABS.map((tab) => {
        const to = cluster ? `${tab.to}?cluster=${cluster}` : tab.to;
        return (
          <NavLink
            key={tab.to}
            to={to}
            className={({ isActive }) => `workload-tab${isActive ? " active" : ""}`}
            end
          >
            {tab.label}
          </NavLink>
        );
      })}
    </div>
  );
}
