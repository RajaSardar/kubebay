import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { Badge, Button, Skeleton, StatusDot } from "@kubebay/ui";
import { api, crdApi, metricsApi, type PrinterColumn } from "../lib/api";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";
import { DEFS, EXTRA_DEFS, ageOf, fmtAge, num, str, type ResourceDef } from "../lib/resources";
import { fmtBytes, fmtCpu } from "./Workloads";
import { useResizableColumns } from "../lib/useResizableColumns";
import { useRowSelection } from "../lib/useRowSelection";
import { useBulkDelete } from "../lib/useBulkDelete";
import { useDisplay, type Density } from "../lib/display";

// Row height (px) per density level — must stay in sync with ROW_PADDING_VALUES in display.ts
// compact: 4+4px pad + ~20px line + 1px border = 29px
// default: 8+8px pad + ~20px line + 1px border = 37px
// relaxed: 12+12px pad + ~20px line + 1px border = 45px
const ROW_HEIGHT: Record<Density, number> = {
  compact: 29,
  default: 37,
  relaxed: 45,
};

function lookupDef(kind: string, sp: URLSearchParams): ResourceDef | undefined {
  if (DEFS[kind]) return DEFS[kind];
  if (EXTRA_DEFS[kind]) return EXTRA_DEFS[kind];
  if (kind.startsWith("ext--")) {
    const parts = kind.slice(5).split("--");
    if (parts.length < 3) return undefined;
    const resource = parts[parts.length - 1] ?? "";
    const version = parts[parts.length - 2] ?? "";
    const group = parts.slice(0, -2).join(".");
    const gvr = group ? `${group}/${version}/${resource}` : `${version}/${resource}`;
    return {
      slug: kind,
      label: resource,
      gvr,
      group,
      resource,
      scoped: sp.get("scoped") === "0",
      mode: "full",
    };
  }
  return undefined;
}
import GenericDrawer from "../components/GenericDrawer";
import { ContextMenu } from "../components/ContextMenu";
import { StarButton } from "../components/Favorites";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { useNamespaceStore, useSelectedNamespaces } from "../lib/namespace-store";
import { WorkloadTabBar, isWorkloadRoute } from "../components/WorkloadTabBar";

type Row = Record<string, unknown>;

export function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

export interface Cell {
  v: string;
  dot?: "ok" | "warn" | "err" | "pending";
  cls?: string;
  /** When set, the cell links to another resource's detail view instead of just displaying text. */
  to?: { kind: string; ns: string; name: string };
}

const DOT: Record<NonNullable<Cell["dot"]>, string> = {
  ok: "connected",
  warn: "degraded",
  err: "unreachable",
  pending: "pending",
};

function healthDot(h: Cell["dot"]) {
  return h ? <StatusDot status={DOT[h]} /> : null;
}

function workloadCells(o: Row): Record<string, Cell> {
  const status = rec(o.status);
  const spec = rec(o.spec);
  const desired = num(spec.replicas);
  const ready = num(status.readyReplicas);
  const updated = num(status.updatedReplicas);
  const available = num(status.availableReplicas);
  const health: Cell["dot"] = ready >= desired && desired > 0 ? "ok" : ready === 0 ? "err" : "warn";
  return {
    Ready: { v: `${ready}/${desired}`, dot: health },
    "Up to date": { v: String(updated) },
    Available: { v: String(available) },
  };
}

export function extraColumns(
  slug: string,
  ctx?: { nodeUsage?: Map<string, { cpuMillis: number; memBytes: number }>; podsPerNode?: Map<string, number> },
): Record<string, (o: Row) => Cell> {
  if (slug === "nodes") {
    const usage = ctx?.nodeUsage;
    const podCounts = ctx?.podsPerNode;
    return {
      Status: (o) => {
        const conds = (rec(o.status).conditions ?? []) as Record<string, unknown>[];
        const ready = conds.find((c) => c.type === "Ready");
        const ok = ready?.status === "True";
        return { v: ok ? "Ready" : "NotReady", dot: ok ? "ok" : "err" };
      },
      "Instance type": (o) => ({ v: str((rec(o.metadata).labels as Record<string, unknown> | undefined)?.["node.kubernetes.io/instance-type"]) || "–" }),
      Zone: (o) => ({ v: str((rec(o.metadata).labels as Record<string, unknown> | undefined)?.["topology.kubernetes.io/zone"]) || "–" }),
      Pods: (o) => ({ v: podCounts ? String(podCounts.get(str(rec(o.metadata).name)) ?? 0) : "–" }),
      Capacity: (o) => {
        const cap = rec(o.status).capacity;
        return { v: `${str(rec(cap).cpu)} cpu · ${str(rec(cap).memory).replace("Ki", "Ki")}` };
      },
      Version: (o) => ({ v: str(rec(rec(o.status).nodeInfo).kubeletVersion) }),
      CPU: (o) => {
        const u = usage?.get(str(rec(o.metadata).name));
        return { v: u ? fmtCpu(u.cpuMillis) : "–" };
      },
      Memory: (o) => {
        const u = usage?.get(str(rec(o.metadata).name));
        return { v: u ? fmtBytes(u.memBytes) : "–" };
      },
    };
  }
  switch (slug) {
    case "deployments":
      return {
        Ready: (o) => workloadCells(o).Ready ?? { v: "" },
        "Up to date": (o) => workloadCells(o)["Up to date"] ?? { v: "" },
        Available: (o) => workloadCells(o).Available ?? { v: "" },
      };
    case "statefulsets":
      return { Ready: (o) => workloadCells(o).Ready ?? { v: "" } };
    case "replicasets":
      return { Ready: (o) => workloadCells(o).Ready ?? { v: "" } };
    case "daemonsets":
      return {
        Desired: (o) => ({ v: String(num(rec(o.status).desiredNumberScheduled)) }),
        Current: (o) => ({ v: String(num(rec(o.status).currentNumberScheduled)) }),
        Ready: (o) => ({
          v: `${num(rec(o.status).numberReady)}/${num(rec(o.spec).desiredNumberScheduled)}`,
          dot:
            num(rec(o.status).numberReady) >= num(rec(o.spec).desiredNumberScheduled)
              ? "ok"
              : num(rec(o.status).numberReady) === 0
                ? "err"
                : "warn",
        }),
      };
    case "jobs":
      return {
        Completions: (o) => {
          const c = rec(o.spec).completions;
          return { v: c == null ? "1" : String(c) };
        },
        Succeeded: (o) => ({ v: String(num(rec(o.status).succeeded)), dot: "ok" }),
        Failed: (o) => ({ v: String(num(rec(o.status).failed)), dot: num(rec(o.status).failed) ? "err" : undefined }),
      };
    case "cronjobs":
      return {
        Schedule: (o) => ({ v: str(rec(o.spec).schedule) || "–" }),
        "Last Schedule": (o) => {
          const t = str(rec(o.status).lastScheduleTime);
          if (!t) return { v: "–" };
          return { v: fmtAge(Date.now() - Date.parse(t)) };
        },
      };
    case "persistentvolumeclaims":
      return {
        Status: (o) => {
          const phase = str(rec(o.status).phase);
          return { v: phase, dot: phase === "Bound" ? "ok" : phase === "Lost" ? "err" : "warn" };
        },
        Volume: (o) => {
          const vol = str(rec(o.spec).volumeName);
          if (!vol) return { v: "–" };
          return { v: vol, to: { kind: "persistentvolumes", ns: "", name: vol } };
        },
        Capacity: (o) => {
          const req = rec(rec(o.spec).resources).requests;
          return { v: str(rec(req).storage) || "–" };
        },
      };
    case "persistentvolumes":
      return {
        Status: (o) => {
          const phase = str(rec(o.status).phase);
          return {
            v: phase,
            dot:
              phase === "Available" || phase === "Bound"
                ? "ok"
                : phase === "Released"
                  ? "warn"
                  : phase === "Failed"
                    ? "err"
                    : "pending",
          };
        },
        Capacity: (o) => ({ v: str(rec(rec(o.spec).capacity).storage) || "–" }),
        Claim: (o) => {
          const claimRef = rec(rec(o.spec).claimRef);
          const name = str(claimRef.name);
          if (!name) return { v: "–" };
          const ns = str(claimRef.namespace);
          return { v: ns ? `${ns}/${name}` : name, to: { kind: "persistentvolumeclaims", ns, name } };
        },
      };
    case "storageclasses":
      return {
        Provisioner: (o) => ({ v: str(rec(o.spec).provisioner) }),
        Reclaim: (o) => ({ v: str(rec(o.spec).reclaimPolicy) || "Delete" }),
        Default: (o) => ({
          v: (rec(o.metadata).annotations as Record<string, unknown> | undefined)?.["storageclass.kubernetes.io/is-default-class"] === "true" ? "Yes" : "–",
        }),
      };
    case "namespaces":
      return {
        Status: (o) => {
          const phase = str(rec(o.status).phase) || "Active";
          return { v: phase, dot: phase === "Active" ? "ok" : "warn" };
        },
      };
    case "endpoints":
      return {
        "EndPoints": (o) => {
          const subsets = (Array.isArray(o.subsets) ? o.subsets : []) as Record<string, unknown>[];
          let count = 0;
          for (const ss of subsets) {
            const addrs = (Array.isArray(ss.addresses) ? ss.addresses : []) as unknown[];
            count += addrs.length;
          }
          return { v: String(count), dot: count > 0 ? "ok" : "warn" };
        },
      };
    case "endpointslices":
      return {
        "EndPoints": (o) => {
          const eps = (rec(o).endpoints ?? []) as unknown[];
          return { v: String(eps.length), dot: eps.length > 0 ? "ok" : "warn" };
        },
        "Address Type": (o) => ({ v: str(rec(o).addressType) || "IPv4" }),
      };
    case "services":
      return {
        Type: (o) => ({ v: str(rec(o.spec).type) || "ClusterIP" }),
        "Cluster IP": (o) => ({ v: str(rec(o.spec).clusterIP) || "–" }),
        Port: (o) => {
          const ports = (rec(o.spec).ports ?? []) as Record<string, unknown>[];
          if (!ports.length) return { v: "–" };
          const p = ports[0] ?? {};
          return { v: `${str(p.port)}${p.nodePort ? ":" + str(p.nodePort) : ""}/${str(p.protocol) || "TCP"}` };
        },
      };
    case "ingresses":
      return {
        Class: (o) => ({ v: str(rec(o.spec).ingressClassName) || "–" }),
        Hosts: (o) => {
          const rules = (rec(o.spec).rules ?? []) as Record<string, unknown>[];
          return { v: rules.map((r) => str(r.host)).filter(Boolean).slice(0, 2).join(", ") || "–" };
        },
      };
    case "configmaps":
      return {
        Data: (o) => ({ v: `${Object.keys(rec(o.data)).length} keys` }),
      };
    case "secrets":
      return {
        Type: (o) => ({ v: str(rec(o).type) || "Opaque" }),
        Data: (o) => ({ v: `${Object.keys(rec(o.data)).length} keys` }),
      };
    case "pods":
      return {
        // Containers column: the cell value is unused — ContainerDots renders the dots
        Containers: (o) => {
          const cs = (rec(o.status).containerStatuses ?? []) as Record<string, unknown>[];
          const total = cs.length || (rec(o.spec).containers as unknown[] | undefined)?.length || 0;
          return { v: String(total) };
        },
        Status: (o) => {
          const phase = str(rec(o.status).phase) || "Unknown";
          let cls: string;
          let dot: Cell["dot"];
          switch (phase) {
            case "Running":    cls = "status-ok";         dot = "ok";      break;
            case "Succeeded":  cls = "status-terminated"; dot = "ok";      break;
            case "Failed":     cls = "status-err";        dot = "err";     break;
            case "Pending":    cls = "status-pending";    dot = "pending"; break;
            case "Terminating": cls = "status-terminating"; dot = undefined; break;
            default:           cls = "muted";             dot = undefined;
          }
          return { v: phase, cls, dot };
        },
        Ready: (o) => {
          const cs = (rec(o.status).containerStatuses ?? []) as Record<string, unknown>[];
          const total = cs.length || (rec(o.spec).containers as unknown[] | undefined)?.length || 0;
          const ready = cs.filter((c) => c.ready === true).length;
          const phase = str(rec(o.status).phase);
          const dot: Cell["dot"] = phase === "Running" && ready === total && total > 0 ? "ok"
            : phase === "Succeeded" ? "ok"
            : phase === "Failed" ? "err"
            : phase === "Pending" ? "pending"
            : ready > 0 ? "warn" : "err";
          return { v: `${ready}/${total}`, dot };
        },
        Restarts: (o) => {
          const cs = (rec(o.status).containerStatuses ?? []) as Record<string, unknown>[];
          const total = cs.reduce((sum, c) => sum + (typeof c.restartCount === "number" ? c.restartCount : 0), 0);
          return { v: String(total), dot: total > 5 ? "err" : total > 0 ? "warn" : undefined };
        },
        "Controlled By": (o) => {
          const owners = (rec(o.metadata).ownerReferences ?? []) as Record<string, unknown>[];
          if (!owners.length) return { v: "–", cls: "muted" };
          const owner = owners[0]!;
          return { v: str(owner.kind) || "–", cls: "cell-secondary" };
        },
        Node: (o) => ({ v: str(rec(o.spec).nodeName) || "–" }),
        QoS: (o) => ({ v: str(rec(o.status).qosClass) || "–", cls: "cell-secondary" }),
        "Pod IP": (o) => ({ v: str(rec(o.status).podIP) || "–" }),
      };
    case "events":
      return {
        Type: (o) => {
          const t = str(rec(o).type);
          return { v: t || "Normal", dot: t === "Warning" ? "warn" : "ok" };
        },
        Reason: (o) => ({ v: str(rec(o).reason) || "–" }),
        Object: (o) => {
          const obj = rec(rec(o).involvedObject);
          const kind = str(obj.kind);
          const name = str(obj.name);
          return { v: kind && name ? `${kind}/${name}` : "–" };
        },
        Message: (o) => ({ v: str(rec(o).message).slice(0, 80) || "–", cls: "mono small" }),
        Count: (o) => ({ v: String(typeof rec(o).count === "number" ? rec(o).count : 1) }),
      };
    default:
      return {};
  }
}

// ── Per-container status squares (FreeLens-style dots) ──────────────────────
type ContainerState = "ok" | "waiting" | "err" | "terminated";

function containerState(cs: Record<string, unknown>): ContainerState {
  if (cs.ready === true) return "ok";
  const st = cs.state as Record<string, unknown> | undefined;
  if (!st) return "waiting";
  if (st.terminated != null) {
    const exitCode = (st.terminated as Record<string, unknown>).exitCode;
    return typeof exitCode === "number" && exitCode !== 0 ? "err" : "terminated";
  }
  if (st.waiting != null) return "waiting";
  return "waiting";
}

const CONTAINER_DOT_COLOR: Record<ContainerState, string> = {
  ok: "var(--kb-status-ok)",
  waiting: "var(--kb-status-pending)",
  err: "var(--kb-status-err)",
  terminated: "var(--kb-status-terminated)",
};

function ContainerDots({ o }: { o: Row }) {
  const cs = (rec(o.status).containerStatuses ?? []) as Record<string, unknown>[];
  const specContainers = (rec(o.spec).containers ?? []) as unknown[];
  const total = cs.length || specContainers.length;
  if (total === 0) return <span className="muted">–</span>;
  return (
    <span className="container-dots">
      {cs.length > 0
        ? cs.map((c, i) => (
            <span
              key={i}
              className="container-dot"
              title={`${str(c.name)}: ${containerState(c)}`}
              style={{ background: CONTAINER_DOT_COLOR[containerState(c)] }}
            />
          ))
        : Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className="container-dot"
              title="pending"
              style={{ background: CONTAINER_DOT_COLOR["waiting"] }}
            />
          ))}
    </span>
  );
}

// Checkbox with indeterminate support
function SelectAllCheckbox({ checked, indeterminate, onChange }: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="kb-checkbox"
      aria-label="Select all"
    />
  );
}

export default function ResourceTable() {
  const { kind = "" } = useParams();
  const [sp] = useSearchParams();
  const def: ResourceDef | undefined = lookupDef(kind, sp);
  const navigate = useNavigate();

  const location = useLocation();
  const { cluster: effectiveCluster } = useCluster();
  const { density } = useDisplay();
  const scrollRef = useRef<HTMLDivElement>(null);

  const nsFilter = useSelectedNamespaces(effectiveCluster || undefined);
  const { setNamespaces } = useNamespaceStore();
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<{ ns: string; name: string } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; ns: string; name: string } | null>(null);
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);

  const stream = useResourceStream(effectiveCluster || undefined, def?.gvr ?? "v1/configmaps", {
    mode: def?.mode,
    ns: def && !def.scoped && nsFilter.length > 0 ? nsFilter : undefined,
  });

  const nodeUsageQ = useRQQuery({
    queryKey: ["nodemetrics", effectiveCluster],
    queryFn: () => metricsApi.nodes(effectiveCluster),
    enabled: !!effectiveCluster && def?.slug === "nodes",
    refetchInterval: 15_000,
    retry: false,
  });
  const nodeUsage = useMemo(() => {
    const m = new Map<string, { cpuMillis: number; memBytes: number }>();
    for (const u of nodeUsageQ.data ?? []) m.set(u.name, u);
    return m;
  }, [nodeUsageQ.data]);

  const nodePods = useResourceStream(
    effectiveCluster || undefined,
    "v1/pods",
    { mode: "full", enabled: def?.slug === "nodes" },
  );
  const podsPerNode = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of nodePods.rows as Record<string, unknown>[]) {
      const nodeName = str(rec(rec(r.spec).nodeName));
      if (nodeName) m.set(nodeName, (m.get(nodeName) ?? 0) + 1);
    }
    return m;
  }, [nodePods.rows]);

  // Fetch CRD metadata (printer columns) for ext-- resources
  const isCRD = kind.startsWith("ext--");
  const crdListQ = useRQQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster && isCRD,
    staleTime: 60_000,
    retry: 1,
  });
  const printerColumns = useMemo<PrinterColumn[]>(() => {
    if (!isCRD || !crdListQ.data || !def) return [];
    const match = crdListQ.data.find((c) => c.gvr === def.gvr);
    return match?.columns ?? [];
  }, [isCRD, crdListQ.data, def]);

  const cols = useMemo(
    () => Object.keys(def ? extraColumns(def.slug, { nodeUsage, podsPerNode }) : {}),
    [def, nodeUsage, podsPerNode],
  );

  function cellFor(slug: string, col: string, o: Row): Cell {
    return extraColumns(slug, { nodeUsage, podsPerNode })[col]?.(o) ?? { v: "" };
  }

  // For CRD printer columns: simple dot-notation JSONPath evaluator
  function evalPrinterCol(col: PrinterColumn, o: Row): string {
    const path = col.jsonPath.replace(/^\{/, "").replace(/\}$/, "").trim();
    if (!path.startsWith(".")) return "";
    const parts = path.slice(1).split(".");
    let cur: unknown = o;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur == null) return "";
    if (typeof cur === "boolean") return cur ? "True" : "False";
    if (typeof cur === "object") return JSON.stringify(cur);
    return String(cur);
  }

  const headers = useMemo(
    () => ["Name", ...(def?.scoped ? [] : ["Namespace"]), ...cols, ...printerColumns.map((c) => c.name), "Age"],
    [def, cols, printerColumns],
  );

  // Column widths: Name=240, Namespace=120, extra cols=110, Age=75
  const initialWidths = useMemo(
    () => headers.map((h) => h === "Name" ? 240 : h === "Namespace" ? 120 : h === "Age" ? 75 : 110),
    [headers],
  );
  const { widths, getResizeHandleProps } = useResizableColumns(headers.length, initialWidths);
  const { selectedKeys, toggleRow, selectAll, clearAll, deselect, isAllSelected, isIndeterminate } = useRowSelection();
  const bulkDelete = useBulkDelete((t) =>
    api.deleteResource({ cluster: effectiveCluster, gvr: def?.gvr ?? "", ns: t.ns, name: t.name }),
  );

  const rows = useMemo(() => {
    let out = [...stream.rows];
    if (search) {
      const q = search.toLowerCase();
      out = out.filter((r) => str(rec(r.metadata).name).toLowerCase().includes(q));
    }
    if (sortCol) {
      out.sort((a, b) => {
        let av: string | number, bv: string | number;
        if (sortCol === "Name") {
          av = str(rec(a.metadata).name);
          bv = str(rec(b.metadata).name);
        } else if (sortCol === "Namespace") {
          av = str(rec(a.metadata).namespace);
          bv = str(rec(b.metadata).namespace);
        } else if (sortCol === "Age") {
          av = ageOf(a);
          bv = ageOf(b);
        } else {
          const cellA = cellFor(def?.slug ?? "", sortCol, a);
          const cellB = cellFor(def?.slug ?? "", sortCol, b);
          av = cellA.v;
          bv = cellB.v;
        }
        if (typeof av === "number" && typeof bv === "number") return sortAsc ? av - bv : bv - av;
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      });
    } else {
      out.sort((a, b) => str(rec(a.metadata).name).localeCompare(str(rec(b.metadata).name)));
    }
    return out;
  }, [stream.rows, search, sortCol, sortAsc, def]);

  const allKeys = useMemo(
    () => rows.map((o) => {
      const meta = rec(o.metadata);
      return `${str(meta.namespace)}/${str(meta.name)}`;
    }),
    [rows],
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT[density],
    overscan: 5,
  });

  if (!def) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Unknown resource "{kind}".</p>
        </div>
      </div>
    );
  }

  function toggleSort(h: string) {
    if (sortCol === h) setSortAsc((a) => !a);
    else { setSortCol(h); setSortAsc(true); }
  }

  async function confirmDelete() {
    const succeeded = await bulkDelete.confirm();
    deselect(succeeded.map((t) => `${t.ns}/${t.name}`));
  }

  return (
    <div className="page">
      {isWorkloadRoute(location.pathname) && <WorkloadTabBar />}
      <div className="page-header">
        <h2>
          {def.label}
          <StarButton path={`/r/${kind}`} />
          {stream.synced && (
            <span className="live-pill">live</span>
          )}
        </h2>
        <div className="page-header-actions">
          {selectedKeys.size > 0 && (
            <>
              <span className="muted small">{selectedKeys.size} selected</span>
              <Button
                variant="danger"
                onClick={() => {
                  bulkDelete.request(
                    [...selectedKeys].map((key) => {
                      const i = key.indexOf("/");
                      return { ns: key.slice(0, i), name: key.slice(i + 1) };
                    }),
                  );
                }}
              >
                Delete {selectedKeys.size} selected
              </Button>
            </>
          )}
          <Badge>{rows.length}</Badge>
        </div>
      </div>

      {bulkDelete.pending && (
        <div className="inline-banner">
          <span>
            {bulkDelete.pending.length === 1 ? (
              <>
                Delete <strong className="mono">{bulkDelete.pending[0]!.name}</strong>
                {bulkDelete.pending[0]!.ns ? ` in ${bulkDelete.pending[0]!.ns}` : ""}? This can&apos;t be undone.
              </>
            ) : (
              <>
                Delete {bulkDelete.pending.length} selected {def.label.toLowerCase()}? This can&apos;t be undone.
              </>
            )}
          </span>
          <div className="inline-banner-actions">
            <Button variant="ghost" disabled={bulkDelete.busy} onClick={bulkDelete.cancel}>
              Cancel
            </Button>
            <Button variant="danger" disabled={bulkDelete.busy} onClick={() => void confirmDelete()}>
              {bulkDelete.busy ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}
      {bulkDelete.error && <div className="inline-banner">{bulkDelete.error}</div>}

      <div className="toolbar">
        {!def.scoped && (
          <NamespaceFilter cluster={effectiveCluster || undefined} />
        )}
        <input
          className="toolbar-input"
          placeholder={`Filter ${def.label.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>

      {!stream.connected || !stream.synced ? (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                <th style={{ width: 40 }} />
                {headers.map((h, i) => <th key={h} style={{ width: widths[i] }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  <td />
                  {headers.map((_, j) => (
                    <td key={j}><Skeleton w={[150, 90, 60, 70, 60, 50][j % 6]} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <p>No {def.label.toLowerCase()} match.</p>
          <p className="muted small">{search || nsFilter.length ? "Loosen the filters." : `Nothing in this ${def.scoped ? "cluster" : "namespace"} yet.`}</p>
        </div>
      ) : (
        <div className="table-wrap" ref={scrollRef}>
          <table className="kb-table">
            <colgroup>
              <col style={{ width: 40 }} />
              {headers.map((h, i) => <col key={h} style={{ width: widths[i] }} />)}
              <col style={{ width: 36 }} /> {/* ⋮ column */}
            </colgroup>
            <thead>
              <tr>
                {/* Select-all checkbox */}
                <th className="col-select" style={{ width: 40 }}>
                  <SelectAllCheckbox
                    checked={isAllSelected(allKeys)}
                    indeterminate={isIndeterminate(allKeys)}
                    onChange={(checked) => checked ? selectAll(allKeys) : clearAll()}
                  />
                </th>
                {headers.map((h, i) => (
                  <th
                    key={h}
                    className="th-sortable"
                    style={{ width: widths[i], position: "relative" }}
                    onClick={() => toggleSort(h)}
                  >
                    {h}
                    {sortCol === h && <span className="sort-indicator">{sortAsc ? " ↑" : " ↓"}</span>}
                    <div className="col-resize-handle" {...getResizeHandleProps(i)} />
                  </th>
                ))}
                <th className="col-row-menu" style={{ width: 36 }} /> {/* ⋮ header spacer */}
              </tr>
            </thead>
            <tbody
              style={{
                paddingTop: rowVirtualizer.getVirtualItems()[0]?.start ?? 0,
                paddingBottom:
                  rowVirtualizer.getTotalSize() -
                  (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0),
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const o = rows[virtualRow.index]!;
                const meta = rec(o.metadata);
                const name = str(meta.name);
                const ns = str(meta.namespace);
                const key = `${ns}/${name}`;
                const isSelected = selectedKeys.has(key);
                const isTerminating = !!rec(o.metadata).deletionTimestamp;
                return (
                  <tr
                    key={key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    data-terminating={isTerminating || undefined}
                    className={`row-clickable${isSelected ? " selected" : ""}${hoveredRowKey === key ? " hovered" : ""}`}
                    onClick={() => setSelected({ ns, name })}
                    onMouseEnter={() => setHoveredRowKey(key)}
                    onMouseLeave={() => setHoveredRowKey(null)}
                    onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, ns, name }); }}
                  >
                    <td className="col-select" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleRow(key)}
                        className="kb-checkbox"
                        aria-label={`Select ${name}`}
                      />
                    </td>
                    <td className="mono td-name" title={name}>{name}</td>
                    {!def.scoped && (
                      <td className="mono">
                        <span
                          className="cell-link ns-pill"
                          title={`Filter by namespace: ${ns}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (effectiveCluster) setNamespaces(effectiveCluster, [ns]);
                          }}
                        >
                          {ns}
                        </span>
                      </td>
                    )}
                    {cols.map((col) => {
                      // Containers column for pods: render per-container dots
                      if (col === "Containers" && def.slug === "pods") {
                        return (
                          <td key={col}>
                            <ContainerDots o={o} />
                          </td>
                        );
                      }
                      const cell = cellFor(def.slug, col, o);
                      return (
                        <td key={col} className="mono muted">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            {cell.dot ? healthDot(cell.dot) : null}
                            {cell.to ? (
                              <span
                                className="cell-link"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/detail/${cell.to!.kind}/${cell.to!.ns || "_"}/${cell.to!.name}`);
                                }}
                              >
                                {cell.v}
                              </span>
                            ) : (
                              <span className={cell.cls ?? ""}>{cell.v}</span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                    {printerColumns.map((col) => (
                      <td key={col.name} className="mono muted">
                        {evalPrinterCol(col, o) || <span className="muted">–</span>}
                      </td>
                    ))}
                    <td className="mono muted">{fmtAge(ageOf(o))}</td>
                    {/* ⋮ kebab — visible only on row hover */}
                    <td className="col-row-menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="row-menu-btn"
                        aria-label="Row actions"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCtx({ x: e.clientX, y: e.clientY, ns, name });
                        }}
                      >
                        ⋮
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {ctx && (
        <ContextMenu
          x={ctx.x}
          y={ctx.y}
          onClose={() => setCtx(null)}
          items={[
            { label: "View details", icon: "📋", onClick: () => setSelected({ ns: ctx.ns, name: ctx.name }) },
            { label: "Edit YAML", icon: "📝", onClick: () => setSelected({ ns: ctx.ns, name: ctx.name }) },
            { separator: true, label: "", onClick: () => {} },
            { label: "Delete", icon: "🗑", danger: true, onClick: () => {
              bulkDelete.request([{ ns: ctx.ns, name: ctx.name }]);
            }},
          ]}
        />
      )}

      {selected && (
        <GenericDrawer
          cluster={effectiveCluster}
          def={def}
          ns={selected.ns}
          name={selected.name}
          onClose={() => setSelected(null)}
          onPopOut={() => {
            setSelected(null);
            navigate(`/detail/${kind}/${selected.ns || "_"}/${selected.name}${sp.toString() ? "?" + sp.toString() : ""}`);
          }}
        />
      )}

      {/* "+" FAB — create new resource */}
      <button
        className="resource-fab"
        aria-label={`Create ${def.label}`}
        title={`Create ${def.label}`}
        onClick={() => {/* TODO: open create-resource sheet */}}
      >
        +
      </button>
    </div>
  );
}
