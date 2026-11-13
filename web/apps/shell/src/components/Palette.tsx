import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Kbd, SegmentedControl, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useClusterStore } from "../lib/cluster-store";
import { getConnectedClusters } from "../lib/clusterConnections";
import { useSavedViews } from "../lib/savedViews";
import { DEFS, EXTRA_DEFS } from "../lib/resources";
import { buildIndex, parseQuery, search, type SearchGroup, type SearchObject } from "../lib/paletteSearch";
import { usePaletteObjects } from "../lib/usePaletteObjects";
import { pushRecent, readRecents, type Recent } from "../lib/paletteRecents";

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
      { label: "Local shell — terminal on this machine", to: "/terminal" },
      { label: "Ports — forward manager", to: "/ports" },
      { label: "Helm releases", to: "/helm" },
      { label: "RBAC explorer", to: "/rbac" },
      { label: "Vulnerabilities — every CVE Trivy-Operator found", to: "/vulnerabilities" },
      { label: "Event Timeline", to: "/timeline" },
      { label: "Topology", to: "/topology" },
      { label: "Settings", to: "/settings" },
    ],
    [],
  );
}

function useDynamicItems(open: boolean): PaletteItem[] {
  // Fetched and polled only while the palette is open: it is mounted for the
  // whole session, and a closed palette should cost nothing.
  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: 30_000, enabled: open });
  const pfs = useQuery({ queryKey: ["pf-palette"], queryFn: api.pfList, staleTime: 10_000, refetchInterval: open ? 30_000 : false, enabled: open });
  const views = useSavedViews((s) => s.views);
  return useMemo(() => {
    // KB-16: saved views first, they're what the user named.
    const out: PaletteItem[] = views.map((v) => ({ label: `View: ${v.name}`, hint: `${v.kind} · ${v.cluster}`, to: `/view/${v.id}` }));
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
  }, [clusters.data, pfs.data, views]);
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

// ──── Status dot mapping ──────────────────────────────────────────────────────

type DotStatus = "connected" | "degraded" | "unreachable" | "pending";

function podStatusDot(kind: LivePod["statusKind"]): DotStatus {
  if (kind === "running") return "connected";
  if (kind === "succeeded") return "connected";
  if (kind === "failed") return "unreachable";
  return "pending";
}

// ──── One result row ──────────────────────────────────────────────────────────

function PaletteRow({
  active,
  label,
  className = "",
  onHover,
  onClick,
  children,
}: {
  active: boolean;
  /** The accessible name, when the visible text alone would run together. */
  label?: string;
  className?: string;
  onHover: () => void;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-label={label}
      className={`palette-item${className ? " " + className : ""}${active ? " active" : ""}`}
      onMouseEnter={onHover}
      onClick={onClick}
    >
      {children}
      <Kbd>↵</Kbd>
    </button>
  );
}

// ──── Opening a result ────────────────────────────────────────────────────────

/** Where an object opens. Pods have no detail page: their list opens the drawer. */
function targetFor(o: { slug: string; ns: string; name: string }): string {
  if (o.slug === "pods") return `/workloads?pod=${encodeURIComponent(`${o.ns}/${o.name}`)}`;
  return `/detail/${o.slug}/${o.ns || "_"}/${o.name}`;
}

/** The kind's list, filtered to what was typed. */
function listTargetFor(slug: string, terms: string): string {
  const q = encodeURIComponent(terms);
  return slug === "pods" ? `/workloads?q=${q}` : `/r/${slug}?q=${q}`;
}

type Scope = "active" | "all";
const SCOPE_KEY = "kb.paletteScope";
function readScope(): Scope {
  try {
    return localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "active";
  } catch {
    return "active";
  }
}

const NAV_WHEN_SEARCHING = 5;
const NAV_WHEN_EMPTY = 8;

type Entry =
  | { kind: "nav"; item: PaletteItem }
  | { kind: "hit"; obj: SearchObject }
  | { kind: "recent"; recent: Recent }
  | { kind: "more"; group: SearchGroup; to: string };

// ──── Palette component ───────────────────────────────────────────────────────

export function Palette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const staticItems = usePaletteItems();
  const dynamicItems = useDynamicItems(open);
  const navItems = useMemo(() => [...staticItems, ...dynamicItems], [staticItems, dynamicItems]);
  const active = useClusterStore((s) => s.active);
  const setActive = useClusterStore((s) => s.setActive);
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [scope, setScope] = useState<Scope>(readScope);
  const [recents, setRecents] = useState<Recent[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
      setRecents(readRecents());
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  // Closed, the palette reads no rows and opens no stream: everything below is
  // empty until it opens. Open, it searches what the connection manager holds.
  const connected = open ? [...getConnectedClusters()].sort() : [];
  const several = connected.length > 1;
  const clusterKey = open ? `${scope}|${active}|${connected.join(",")}` : "";
  const clusters = useMemo(
    () => (!open ? [] : scope === "all" && several ? connected : active ? [active] : []),
    [clusterKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const objects = usePaletteObjects(open, clusters);
  const index = useMemo(() => buildIndex(objects), [objects]);
  const groups = useMemo(() => (q.trim() ? search(index, q) : []), [index, q]);
  const showCluster = scope === "all" && several;

  const filteredNav = useMemo(() => {
    if (!q) return navItems.slice(0, NAV_WHEN_EMPTY);
    const ql = q.toLowerCase();
    return navItems.filter((i) => i.label.toLowerCase().includes(ql)).slice(0, NAV_WHEN_SEARCHING);
  }, [q, navItems]);

  const termText = parseQuery(q).terms.join(" ");
  const flatEntries = useMemo<Entry[]>(() => {
    const out: Entry[] = filteredNav.map((item) => ({ kind: "nav", item }));
    for (const g of groups) {
      for (const h of g.hits) out.push({ kind: "hit", obj: h.obj });
      if (g.total > g.hits.length) out.push({ kind: "more", group: g, to: listTargetFor(g.slug, termText) });
    }
    if (!q.trim()) for (const recent of recents) out.push({ kind: "recent", recent });
    return out;
  }, [filteredNav, groups, recents, q, termText]);

  // Clamp idx whenever the list changes
  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, flatEntries.length - 1)));
  }, [flatEntries.length]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    nav(to);
  }

  function openObject(o: { cluster: string; slug: string; ns: string; name: string }) {
    pushRecent({ cluster: o.cluster, slug: o.slug, ns: o.ns, name: o.name });
    if (o.cluster !== active) setActive(o.cluster);
    go(targetFor(o));
  }

  function activate(entry: Entry) {
    if (entry.kind === "nav") go(entry.item.to);
    else if (entry.kind === "hit") openObject(entry.obj);
    else if (entry.kind === "recent") openObject(entry.recent);
    else go(entry.to);
  }

  function changeScope(next: Scope) {
    setScope(next);
    try {
      localStorage.setItem(SCOPE_KEY, next);
    } catch {
      /* storage blocked: the choice lasts until the palette closes */
    }
  }

  // One result row: a status dot for pods, the name, where it lives.
  function objectRow(o: SearchObject, globalIdx: number, key: string) {
    const pod = o.slug === "pods" && o.row ? deriveLivePod(o.row, o.cluster) : null;
    const label = [o.name, o.ns && `in ${o.ns}`, showCluster && `on ${o.cluster}`].filter(Boolean).join(" ");
    return (
      <PaletteRow
        key={key}
        label={label}
        className="palette-item--pod"
        active={globalIdx === idx}
        onHover={() => setIdx(globalIdx)}
        onClick={() => openObject(o)}
      >
        <span className="palette-pod-row">
          {pod && <StatusDot status={podStatusDot(pod.statusKind)} />}
          <span className="palette-pod-name">{o.name}</span>
          {o.ns && <span className="palette-pod-ns">{o.ns}</span>}
          {showCluster && <span className="palette-pod-ns">{o.cluster}</span>}
          {pod && <span className={`palette-pod-status palette-pod-status--${pod.statusKind}`}>{pod.statusLabel}</span>}
        </span>
      </PaletteRow>
    );
  }

  let n = filteredNav.length; // running index into flatEntries for hover and highlight

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search deployments, pods, nodes, pages…  (try: deploy api)"
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

        {several && (
          <div style={{ padding: "6px 14px" }}>
            <SegmentedControl<Scope>
              label="Search scope"
              value={scope}
              onChange={changeScope}
              options={[
                { value: "active", label: "This cluster" },
                { value: "all", label: "All clusters" },
              ]}
            />
          </div>
        )}

        <div className="palette-list">
          {/* ── Navigate section ── */}
          {filteredNav.length > 0 && (
            <>
              <div className="palette-section-header">Navigate</div>
              {filteredNav.map((item, i) => (
                <PaletteRow key={`nav:${item.to}:${item.label}`} active={i === idx} onHover={() => setIdx(i)} onClick={() => go(item.to)}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
                </PaletteRow>
              ))}
            </>
          )}

          {/* ── Objects, grouped by kind ── */}
          {groups.map((g) => {
            const rows = g.hits.map((h) => objectRow(h.obj, n++, `hit:${h.obj.cluster}/${h.obj.slug}/${h.obj.ns}/${h.obj.name}`));
            const moreIdx = g.total > g.hits.length ? n++ : -1;
            return (
              <div key={g.slug}>
                <div className="palette-section-header palette-section-header--live">
                  <span>{g.label}</span>
                  <span className="palette-section-loading">{g.total}</span>
                </div>
                {rows}
                {moreIdx >= 0 && (
                  <PaletteRow active={moreIdx === idx} onHover={() => setIdx(moreIdx)} onClick={() => go(listTargetFor(g.slug, termText))}>
                    <span>{`Show all ${g.total} ${g.label}`}</span>
                  </PaletteRow>
                )}
              </div>
            );
          })}

          {/* ── Recently opened ── */}
          {!q.trim() && recents.length > 0 && (
            <>
              <div className="palette-section-header">Recent</div>
              {recents.map((r) => objectRow({ ...r }, n++, `recent:${r.cluster}/${r.slug}/${r.ns}/${r.name}`))}
            </>
          )}

          {/* Empty state */}
          {q.trim() !== "" && flatEntries.length === 0 && <div className="muted small" style={{ padding: "10px 14px" }}>No matches.</div>}
        </div>
      </div>
    </div>
  );
}
