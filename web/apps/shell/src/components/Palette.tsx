import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Kbd, SegmentedControl, StatusDot } from "@kubebay/ui";
import { api } from "../lib/api";
import { useClusterStore } from "../lib/cluster-store";
import { useClusterMeta } from "../lib/cluster-meta-store";
import { clusterChoices, matchClusters, type ClusterChoice } from "../lib/paletteClusters";
import { openCluster } from "../lib/openCluster";
import { getConnectedClusters, isClusterSynced } from "../lib/clusterConnections";
import { useSavedViews } from "../lib/savedViews";
import { DEFS, EXTRA_DEFS } from "../lib/resources";
import { buildIndex, mergeGroups, parseQuery, search, type SearchGroup, type SearchObject } from "../lib/paletteSearch";
import { usePaletteRemote } from "../lib/usePaletteRemote";
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
  const pfs = useQuery({ queryKey: ["pf-palette"], queryFn: api.pfList, staleTime: 10_000, refetchInterval: open ? 30_000 : false, enabled: open });
  const views = useSavedViews((s) => s.views);
  return useMemo(() => {
    // KB-16: saved views first, they're what the user named. Clusters are not
    // here: the palette's "Switch cluster" section lists them.
    const out: PaletteItem[] = views.map((v) => ({ label: `View: ${v.name}`, hint: `${v.kind} · ${v.cluster}`, to: `/view/${v.id}` }));
    for (const f of pfs.data ?? []) {
      out.push({
        label: `Port-forward 127.0.0.1:${f.localPort} → ${f.namespace}/${f.pod}:${f.podPort}`,
        to: "/ports",
      });
    }
    return out;
  }, [pfs.data, views]);
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
function targetFor(o: { slug: string; ns: string; name: string; clusterScoped?: boolean }): string {
  if (o.slug === "pods") return `/workloads?pod=${encodeURIComponent(`${o.ns}/${o.name}`)}`;
  // A CRD opens the CRDs page at its API group: its name is "plural.group".
  if (o.slug === "crds") return `/crds?group=${encodeURIComponent(o.name.slice(o.name.indexOf(".") + 1))}`;
  const base = `/detail/${o.slug}/${o.ns || "_"}/${o.name}`;
  // A custom resource with no namespace must say so; the route cannot tell.
  return o.slug.startsWith("ext--") && !o.ns ? `${base}?scoped=0` : base;
}

/** The kind's list, filtered to what was typed. */
function listTargetFor(slug: string, terms: string, clusterScoped = false): string {
  const q = encodeURIComponent(terms);
  if (slug === "pods") return `/workloads?q=${q}`;
  if (slug === "crds") return `/crds`;
  return `/r/${slug}?q=${q}${clusterScoped ? "&scoped=0" : ""}`;
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
const NAV_WITH_OBJECTS = 3;
const NAV_WHEN_EMPTY = 8;

type Entry =
  | { kind: "nav"; item: PaletteItem }
  | { kind: "hit"; obj: SearchObject }
  | { kind: "recent"; recent: Recent }
  | { kind: "more"; group: SearchGroup; to: string }
  | { kind: "cluster"; choice: ClusterChoice };

interface Section {
  key: string;
  title: string;
  /** How many matched, for a group of objects. */
  count?: number;
  entries: Entry[];
}

const CLUSTERS_PLAIN = 3;
const CLUSTERS_ASKED = 8;
const CLUSTERS_EMPTY = 4;

function clusterDot(c: ClusterChoice): "connected" | "unreachable" | "pending" | "degraded" {
  if (c.status === "unreachable" || c.status === "misconfigured") return "unreachable";
  if (c.status === "checking") return "pending";
  if (c.status === "degraded") return "degraded";
  return "connected";
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
  const dynamicItems = useDynamicItems(open);
  const navItems = useMemo(() => [...staticItems, ...dynamicItems], [staticItems, dynamicItems]);
  const active = useClusterStore((s) => s.active);
  const setActive = useClusterStore((s) => s.setActive);
  const meta = useClusterMeta((s) => s.meta);
  const queryClient = useQueryClient();
  const clusterList = useQuery({ queryKey: ["clusters"], queryFn: api.clusters, staleTime: 30_000, enabled: open });
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
  const localGroups = useMemo(() => (q.trim() ? search(index, q) : []), [index, q]);
  // The engine answers for the kinds the app does not hold in memory.
  const remote = usePaletteRemote(open, clusters, q);
  const groups = useMemo(() => {
    // A query naming a kind the engine knows ("rollouts api") is about that
    // kind alone: a Deployment called rollouts-api is not an answer to it.
    const local = remote.filter ? localGroups.filter((g) => g.slug === remote.filter) : localGroups;
    return mergeGroups(local, remote.groups, { listing: parseQuery(q).terms.length === 0 });
  }, [localGroups, remote.groups, remote.filter, q]);
  const showCluster = scope === "all" && several;
  const loading = open && clusters.some((c) => !isClusterSynced(c));

  // Entries that start with what was typed come first, then ones with a word
  // that does, then the rest. With objects to show, fewer pages crowd them out.
  const filteredNav = useMemo(() => {
    if (!q) return navItems.slice(0, NAV_WHEN_EMPTY);
    const ql = q.toLowerCase();
    const rank = (label: string) => {
      const l = label.toLowerCase();
      const at = l.indexOf(ql);
      return at < 0 ? -1 : at === 0 ? 0 : /[\s:\-/]/.test(l[at - 1] ?? "") ? 1 : 2;
    };
    return navItems
      .map((item) => ({ item, r: rank(item.label) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .slice(0, groups.length > 0 ? NAV_WITH_OBJECTS : NAV_WHEN_SEARCHING)
      .map((x) => x.item);
  }, [q, navItems, groups.length]);

  // Which clusters to offer switching to: typed words ("switch prod", "@stage"
  // or just part of a name), or your most recent ones when the box is empty.
  const choices = useMemo(() => clusterChoices(clusterList.data ?? [], meta, active), [clusterList.data, meta, active]);
  const clusterMatch = useMemo(() => (open ? matchClusters(choices, q, CLUSTERS_ASKED) : { intent: false, list: [] }), [open, choices, q]);
  const clusterRows = useMemo(
    () => clusterMatch.list.slice(0, clusterMatch.intent ? CLUSTERS_ASKED : q.trim() ? CLUSTERS_PLAIN : CLUSTERS_EMPTY),
    [clusterMatch, q],
  );

  const termText = parseQuery(q).terms.join(" ");
  const sections = useMemo<Section[]>(() => {
    const navSection: Section[] = filteredNav.length
      ? [{ key: "nav", title: "Navigate", entries: filteredNav.map((item) => ({ kind: "nav", item })) }]
      : [];
    const objectSections: Section[] = groups.map((g) => ({
      key: `g:${g.slug}`,
      title: g.label,
      count: g.total,
      entries: [
        ...g.hits.map((h): Entry => ({ kind: "hit", obj: h.obj })),
        ...(g.total > g.hits.length ? [{ kind: "more", group: g, to: listTargetFor(g.slug, termText, g.hits[0]?.obj.clusterScoped) } as Entry] : []),
      ],
    }));
    const clusterSection: Section[] = clusterRows.length
      ? [{ key: "clusters", title: "Switch cluster", entries: clusterRows.map((choice) => ({ kind: "cluster", choice })) }]
      : [];
    const recentSection: Section[] =
      !q.trim() && recents.length ? [{ key: "recent", title: "Recent", entries: recents.map((recent) => ({ kind: "recent", recent })) }] : [];
    // Asking for a cluster ("switch ...", "@...") puts the clusters first.
    return clusterMatch.intent
      ? [...clusterSection, ...navSection, ...objectSections]
      : [...navSection, ...objectSections, ...clusterSection, ...recentSection];
  }, [filteredNav, groups, clusterRows, clusterMatch.intent, recents, q, termText]);
  const flatEntries = useMemo(() => sections.flatMap((s) => s.entries), [sections]);

  const notes = useMemo(() => {
    const out: { key: string; text: string; title?: string }[] = [];
    if (loading) out.push({ key: "local", text: "Still loading this cluster, so results may be incomplete." });
    if (remote.pending.length > 0) out.push({ key: "pending", text: `Still loading ${remote.pending.join(", ")}. More may appear.` });
    if (remote.denied.length > 0) {
      out.push({
        key: "denied",
        text: `Can't list ${remote.denied.map((d) => d.label).join(", ")} with your access.`,
        title: remote.denied.map((d) => `${d.label}: ${d.reason}`).join("\n"),
      });
    }
    if (remote.truncated.length > 0) out.push({ key: "truncated", text: `Too many ${remote.truncated.join(", ")} to search them all.` });
    if (remote.error) out.push({ key: "error", text: `Couldn't search other kinds: ${remote.error}` });
    if (remote.onDemand.length > 0 && !remote.filter && q.trim().length >= 2) {
      const shown = remote.onDemand.slice(0, 6).join(", ") + (remote.onDemand.length > 6 ? "…" : "");
      const word = remote.onDemand[0]!.toLowerCase();
      out.push({ key: "ondemand", text: `Not searched unless you name them: ${shown}. Try: ${word} ${q.trim().split(/\s+/)[0]}` });
    }
    return out;
  }, [loading, remote, q]);

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

  function switchTo(c: ClusterChoice) {
    // A cluster whose kubeconfig is broken can't open: the Clusters page says why.
    if (!c.usable) return go("/clusters");
    onClose();
    openCluster(c.id, queryClient, nav);
  }

  function activate(entry: Entry) {
    if (entry.kind === "nav") go(entry.item.to);
    else if (entry.kind === "hit") openObject(entry.obj);
    else if (entry.kind === "recent") openObject(entry.recent);
    else if (entry.kind === "cluster") switchTo(entry.choice);
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

  function objectRow(o: SearchObject, i: number, key: string) {
    const pod = o.slug === "pods" && o.row ? deriveLivePod(o.row, o.cluster) : null;
    const label = [o.name, o.ns && `in ${o.ns}`, showCluster && `on ${o.cluster}`].filter(Boolean).join(" ");
    return (
      <PaletteRow key={key} label={label} className="palette-item--pod" active={i === idx} onHover={() => setIdx(i)} onClick={() => openObject(o)}>
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

  function renderEntry(e: Entry, i: number) {
    switch (e.kind) {
      case "nav":
        return (
          <PaletteRow key={`nav:${e.item.to}:${e.item.label}`} active={i === idx} onHover={() => setIdx(i)} onClick={() => go(e.item.to)}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.item.label}</span>
          </PaletteRow>
        );
      case "hit":
        return objectRow(e.obj, i, `hit:${e.obj.cluster}/${e.obj.slug}/${e.obj.ns}/${e.obj.name}`);
      case "recent":
        return objectRow({ ...e.recent }, i, `recent:${e.recent.cluster}/${e.recent.slug}/${e.recent.ns}/${e.recent.name}`);
      case "more":
        return (
          <PaletteRow key={`more:${e.group.slug}`} active={i === idx} onHover={() => setIdx(i)} onClick={() => go(e.to)}>
            <span>{`Show all ${e.group.total} ${e.group.label}`}</span>
          </PaletteRow>
        );
      case "cluster":
        return (
          <PaletteRow
            key={`cluster:${e.choice.id}`}
            label={`Switch to ${e.choice.name}`}
            className="palette-item--pod"
            active={i === idx}
            onHover={() => setIdx(i)}
            onClick={() => switchTo(e.choice)}
          >
            <span className="palette-pod-row">
              <StatusDot status={clusterDot(e.choice)} />
              <span className="palette-pod-name">{e.choice.name}</span>
              <span className="palette-pod-ns">{e.choice.usable ? (e.choice.connected ? "connected" : e.choice.status) : "can't open: see Clusters"}</span>
            </span>
          </PaletteRow>
        );
    }
  }

  let at = 0; // index of the next entry in the flat list, for hover and highlight

  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette-box" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Search deployments, pods, nodes, pages… or switch cluster  (try: deploy api, @prod)"
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
          {sections.map((sec) => (
            <div key={sec.key}>
              {sec.count !== undefined ? (
                <div className="palette-section-header palette-section-header--live">
                  <span>{sec.title}</span>
                  <span className="palette-section-loading">{sec.count}</span>
                </div>
              ) : (
                <div className="palette-section-header">{sec.title}</div>
              )}
              {sec.entries.map((e) => renderEntry(e, at++))}
            </div>
          ))}

          {/* Say what was not searched, so a short list is never mistaken for the whole cluster */}
          {q.trim() !== "" &&
            notes.map((n) => (
              <div key={n.key} className="muted small" style={{ padding: "6px 14px" }} title={n.title}>
                {n.text}
              </div>
            ))}

          {/* Empty state */}
          {q.trim() !== "" && flatEntries.length === 0 && <div className="muted small" style={{ padding: "10px 14px" }}>No matches.</div>}
        </div>
      </div>
    </div>
  );
}
