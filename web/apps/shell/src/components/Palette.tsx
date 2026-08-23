import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

export interface PaletteItem {
  label: string;
  hint?: string;
  to: string;
}

export function usePaletteItems(): PaletteItem[] {
  const nav = useNavigate();
  void nav;
  return useMemo(
    () => [
      { label: "Overview", to: "/" },
      { label: "Fleet", to: "/fleet" },
      { label: "Pods", to: "/workloads" },
      { label: "Deployments", to: "/r/deployments" },
      { label: "ReplicaSets", to: "/r/replicasets" },
      { label: "StatefulSets", to: "/r/statefulsets" },
      { label: "DaemonSets", to: "/r/daemonsets" },
      { label: "Jobs", to: "/r/jobs" },
      { label: "CronJobs", to: "/r/cronjobs" },
      { label: "ConfigMaps", to: "/r/configmaps" },
      { label: "Secrets", to: "/r/secrets" },
      { label: "Services", to: "/r/services" },
      { label: "Ingresses", to: "/r/ingresses" },
      { label: "NetworkPolicies", to: "/r/networkpolicies" },
      { label: "HPAs", to: "/r/horizontalpodautoscalers" },
      { label: "PDBs", to: "/r/poddisruptionbudgets" },
      { label: "ResourceQuotas", to: "/r/resourcequotas" },
      { label: "LimitRanges", to: "/r/limitranges" },
      { label: "PVCs", to: "/r/persistentvolumeclaims" },
      { label: "PVs", to: "/r/persistentvolumes" },
      { label: "StorageClasses", to: "/r/storageclasses" },
      { label: "Nodes", to: "/r/nodes" },
      { label: "Namespaces", to: "/r/namespaces" },
      { label: "ServiceAccounts", to: "/r/serviceaccounts" },
      { label: "Roles", to: "/r/roles" },
      { label: "ClusterRoles", to: "/r/clusterroles" },
      { label: "RoleBindings", to: "/r/rolebindings" },
      { label: "ClusterRoleBindings", to: "/r/clusterrolebindings" },
      { label: "Ports — forward manager", to: "/ports" },
      { label: "Helm releases", to: "/helm" },
      { label: "RBAC explorer", to: "/rbac" },
      { label: "Event Timeline", to: "/timeline" },
      { label: "Topology", to: "/topology" },
      { label: "Settings", to: "/settings" },
    ],
    [],
  );
}

export function Palette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const items = usePaletteItems();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!q) return items.slice(0, 9);
    const ql = q.toLowerCase();
    return items.filter((i) => i.label.toLowerCase().includes(ql)).slice(0, 9);
  }, [q, items]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    nav(to);
  }

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Jump to…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, filtered.length - 1));
            else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter" && filtered[idx]) go(filtered[idx].to);
          }}
          spellCheck={false}
        />
        <div className="palette-list">
          {filtered.map((f, i) => (
            <button
              key={f.to}
              className={`palette-item${i === idx ? " active" : ""}`}
              onMouseEnter={() => setIdx(i)}
              onClick={() => go(f.to)}
            >
              {f.label}
              <kbd>↵</kbd>
            </button>
          ))}
          {filtered.length === 0 && <div className="muted small" style={{ padding: "10px 14px" }}>No matches.</div>}
        </div>
      </div>
    </div>
  );
}
