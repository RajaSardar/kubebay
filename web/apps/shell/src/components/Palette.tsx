import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { StatusDot } from "@kubebay/ui";
import { api, type ClusterInfo } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { DEFS, EXTRA_DEFS } from "../lib/resources";

// ──── Nav items (static routes) ──────────────────────────────────────────────

export interface PaletteItem {
  label: string;
  hint?: string;
  to: string;
}

// Curated ordering for the resource kinds surfaced most often. Anything in
// DEFS/EXTRA_DEFS that isn't listed here still shows up (alphabetically,
// appended after the curated set) so newly-added resource kinds are never
// silently missing from the palette.
const CURATED_RESOURCE_ORDER = [
  "deployments",
  "replicasets",
  "statefulsets",
  "daemonsets",
  "jobs",
  "cronjobs",
  "configmaps",
  "secrets",
  "services",
  "ingresses",
  "networkpolicies",
  "horizontalpodautoscalers",
  "poddisruptionbudgets",
  "resourcequotas",
  "limitranges",
  "persistentvolumeclaims",
  "persistentvolumes",
  "storageclasses",
  "nodes",
  "namespaces",
  "serviceaccounts",
  "roles",
  "clusterroles",
  "rolebindings",
  "clusterrolebindings",
];

function resourceNavItems(): PaletteItem[] {
  const all = { ...DEFS, ...EXTRA_DEFS };
  const entries = Object.entries(all);
  const bySlug = new Map(entries);
  const curated = CURATED_RESOURCE_ORDER.flatMap((slug) => {
    const def = bySlug.get(slug);
    return def ? [{ label: def.label, to: `/r/${slug}` }] : [];
  });
  const seen = new Set(CURATED_RESOURCE_ORDER);
  const rest = entries
    .filter(([slug]) => !seen.has(slug))
    .sort(([, a], [, b]) => a.label.localeCompare(b.label))
    .map(([slug, def]) => ({ label: def.label, to: `/r/${slug}` }));
  return [...curated, ...rest];
}

export function usePaletteItems(): PaletteItem[] {
  return useMemo(
    () => [
      { label: "Overview", to: "/" },
      { label: "Pods", to: "/workloads" },
      ...resourceNavItems(),
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

function useDynamicItems(): PaletteItem[] {
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: 30_000 });
  const pfs = useQuery({ queryKey: ["pf-palette"], queryFn: api.pfList, staleTime: 10_000, refetchInterval: 30_000 });
  return useMemo(() => {
    const out: PaletteItem[] = [];
    for (const c of clusters.data ?? []) {
      out.push({ label: `Cluster: ${c.id}`, hint: c.status, to: `/workloads?cluster=${encodeURIComponent(c.id)}` });
    }
    for (const f of pfs.data ?? []) {
      out.push({
        label: `Port-forward 127.0.0.1:${f.localPort} → ${f.namespace}/${f.pod}:${f.podPort}`,
        to: "/ports",
      });
    }
    return out;
  }, [clusters.data, pfs.data]);
}

// ──── Live pod items ──────────────────────────────────────────────────────────

interface LivePod {
  key: string;
  name: string;
  namespace: string;
  statusLabel: string;
  statusKind: "running" | "succeeded" | "pending" | "failed";
  cluster: string;
  to: string;
}

function asRec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function deriveLivePod(obj: Record<string, unknown>, cluster: string): LivePod | null {
  const meta = asRec(obj.metadata);
  const name = meta.name as string | undefined;
  const namespace = (meta.namespace as string) ?? "default";
  if (!name) return null;

  const spec = asRec(obj.spec);
  const status = asRec(obj.status);
  const containers = (spec.containers ?? []) as unknown[];
  const containerStatuses = (status.containerStatuses ?? []) as Record<string, unknown>[];
  const readyCount = containerStatuses.filter((cs) => cs.ready === true).length;
  const phase = (status.phase as string) ?? "Unknown";

  let statusKind: LivePod["statusKind"] = "pending";
  let statusLabel = phase;

  if (meta.deletionTimestamp) {
    statusKind = "pending";
    statusLabel = "Terminating";
  } else {
    for (const cs of containerStatuses) {
      const waiting = asRec(asRec(cs.state).waiting);
      const reason = waiting.reason as string | undefined;
      if (reason && reason !== "ContainerCreating") {
        statusKind = "failed";
        statusLabel = reason;
        break;
      }
    }
    if (statusKind !== "failed") {
      if (phase === "Running" && containers.length > 0 && readyCount === containers.length) {
        statusKind = "running";
        statusLabel = "Running";
      } else if (phase === "Succeeded") {
        statusKind = "succeeded";
        statusLabel = "Succeeded";
      } else if (phase === "Failed") {
        statusKind = "failed";
        statusLabel = "Failed";
      }
    }
  }

  return {
    key: `${cluster}/${namespace}/${name}`,
    name,
    namespace,
    statusLabel,
    statusKind,
    cluster,
    to: `/workloads?cluster=${encodeURIComponent(cluster)}&filter=${encodeURIComponent(name)}`,
  };
}

function useLivePods(): { pods: LivePod[]; connected: boolean; loading: boolean } {
  const queryClient = useQueryClient();
  const clusterList = queryClient.getQueryData<ClusterInfo[]>(["clusters"]) ?? [];
  const activeCluster = clusterList.find((c) => c.status === "connected");
  const cluster = activeCluster?.id;

  const stream = useResourceStream(cluster, "v1/pods", { mode: "full", enabled: !!cluster });

  const pods = useMemo(() => {
    if (!cluster) return [];
    return stream.rows
      .map((row) => deriveLivePod(row as Record<string, unknown>, cluster))
      .filter((p): p is LivePod => p !== null);
  }, [stream.rows, cluster]);

  return {
    pods,
    connected: stream.connected,
    loading: !stream.synced && stream.connected,
  };
}

// ──── Status dot mapping ──────────────────────────────────────────────────────

type DotStatus = "connected" | "degraded" | "unreachable" | "pending";

function podStatusDot(kind: LivePod["statusKind"]): DotStatus {
  if (kind === "running") return "connected";
  if (kind === "succeeded") return "connected";
  if (kind === "failed") return "unreachable";
  return "pending";
}

// ──── Palette component ───────────────────────────────────────────────────────

export function Palette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const staticItems = usePaletteItems();
  const dynamicItems = useDynamicItems();
  const navItems = useMemo(() => [...staticItems, ...dynamicItems], [staticItems, dynamicItems]);
  const { pods, connected, loading } = useLivePods();
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

  // Filter nav items
  const filteredNav = useMemo(() => {
    if (!q) return navItems.slice(0, 8);
    const ql = q.toLowerCase();
    return navItems.filter((i) => i.label.toLowerCase().includes(ql)).slice(0, 8);
  }, [q, navItems]);

  // Filter live pods — search across name, namespace, statusLabel
  const filteredPods = useMemo(() => {
    if (!q) return pods.slice(0, 5);
    const ql = q.toLowerCase();
    return pods
      .filter(
        (p) =>
          p.name.toLowerCase().includes(ql) ||
          p.namespace.toLowerCase().includes(ql) ||
          p.statusLabel.toLowerCase().includes(ql) ||
          p.cluster.toLowerCase().includes(ql),
      )
      .slice(0, 8);
  }, [q, pods]);

  // Unified flat list for keyboard nav: nav items first, then pod items
  // Each entry carries a type so we can dispatch the right action
  type FlatNav = { kind: "nav"; item: PaletteItem };
  type FlatPod = { kind: "pod"; pod: LivePod };
  type FlatEntry = FlatNav | FlatPod;

  const flatEntries = useMemo<FlatEntry[]>(() => {
    const out: FlatEntry[] = [];
    for (const item of filteredNav) out.push({ kind: "nav", item });
    for (const pod of filteredPods) out.push({ kind: "pod", pod });
    return out;
  }, [filteredNav, filteredPods]);

  // Clamp idx whenever flat list changes
  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, flatEntries.length - 1)));
  }, [flatEntries.length]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    nav(to);
  }

  function activate(entry: FlatEntry) {
    if (entry.kind === "nav") go(entry.item.to);
    else go(entry.pod.to);
  }

  const showLiveSection = connected || loading || pods.length > 0;

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search pods, namespaces, pages…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            else if (e.key === "ArrowDown") setIdx((i) => Math.min(i + 1, flatEntries.length - 1));
            else if (e.key === "ArrowUp") setIdx((i) => Math.max(i - 1, 0));
            else if (e.key === "Enter" && flatEntries[idx]) activate(flatEntries[idx]);
          }}
          spellCheck={false}
        />

        <div className="palette-list">
          {/* ── Navigate section ── */}
          {filteredNav.length > 0 && (
            <>
              <div className="palette-section-header">Navigate</div>
              {filteredNav.map((item, i) => {
                const globalIdx = i;
                return (
                  <button
                    key={`nav:${item.to}:${item.label}`}
                    className={`palette-item${globalIdx === idx ? " active" : ""}`}
                    onMouseEnter={() => setIdx(globalIdx)}
                    onClick={() => go(item.to)}
                  >
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.label}
                    </span>
                    <kbd>↵</kbd>
                  </button>
                );
              })}
            </>
          )}

          {/* ── Live: Pods section ── */}
          {showLiveSection && (
            <>
              <div className="palette-section-header palette-section-header--live">
                <span>Live: Pods</span>
                {loading && (
                  <span className="palette-section-loading">syncing…</span>
                )}
              </div>

              {!connected && !loading && pods.length === 0 && (
                <div className="muted small" style={{ padding: "8px 14px" }}>
                  No cluster connected
                </div>
              )}

              {connected && pods.length === 0 && !loading && (
                <div className="muted small" style={{ padding: "8px 14px" }}>
                  {q ? "No pods match." : "No pods found."}
                </div>
              )}

              {filteredPods.map((pod, i) => {
                const globalIdx = filteredNav.length + i;
                return (
                  <button
                    key={`pod:${pod.key}`}
                    className={`palette-item palette-item--pod${globalIdx === idx ? " active" : ""}`}
                    onMouseEnter={() => setIdx(globalIdx)}
                    onClick={() => go(pod.to)}
                  >
                    <span className="palette-pod-row">
                      <StatusDot status={podStatusDot(pod.statusKind)} />
                      <span className="palette-pod-name">{pod.name}</span>
                      <span className="palette-pod-ns">{pod.namespace}</span>
                      <span className={`palette-pod-status palette-pod-status--${pod.statusKind}`}>
                        {pod.statusLabel}
                      </span>
                    </span>
                    <kbd>↵</kbd>
                  </button>
                );
              })}
            </>
          )}

          {/* Empty state */}
          {flatEntries.length === 0 && !loading && (
            <div className="muted small" style={{ padding: "10px 14px" }}>
              No matches.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
