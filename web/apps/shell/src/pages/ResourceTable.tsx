import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Skeleton, StatusDot } from "@kubebay/ui";
import { api, metricsApi } from "../lib/api";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { useResourceStream } from "../lib/useResourceStream";
import { DEFS, EXTRA_DEFS, ageOf, fmtAge, num, str, type ResourceDef } from "../lib/resources";
import { fmtBytes, fmtCpu } from "./Workloads";

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
import { NamespaceFilter } from "../components/NamespaceFilter";

type Row = Record<string, unknown>;

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

interface Cell {
  v: string;
  dot?: "ok" | "warn" | "err" | "pending";
  cls?: string;
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

function extraColumns(
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
      "Instance type": (o) => ({ v: str(rec(o.metadata).labels?.["node.kubernetes.io/instance-type"]) || "–" }),
      Zone: (o) => ({ v: str(rec(o.metadata).labels?.["topology.kubernetes.io/zone"]) || "–" }),
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
    case "persistentvolumeclaims":
      return {
        Status: (o) => {
          const phase = str(rec(o.status).phase);
          return { v: phase, dot: phase === "Bound" ? "ok" : phase === "Lost" ? "err" : "warn" };
        },
        Volume: (o) => ({ v: str(rec(o.spec).volumeName) || "–" }),
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
      };
    case "storageclasses":
      return {
        Provisioner: (o) => ({ v: str(rec(o.spec).provisioner) }),
        Reclaim: (o) => ({ v: str(rec(o.spec).reclaimPolicy) || "Delete" }),
      };
    case "endpoints":
      return {
        "EndPoints": (o) => {
          const subsets = (rec(o.subsets) ?? []) as Record<string, unknown>[];
          let count = 0;
          for (const ss of subsets) {
            const addrs = (ss.addresses ?? []) as unknown[];
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
    default:
      return {};
  }
}

export default function ResourceTable() {
  const { kind = "" } = useParams();
  const [sp] = useSearchParams();
  const def: ResourceDef | undefined = lookupDef(kind, sp);

  const clusters = useQuery({ queryKey: ["clusters"], queryFn: api.clusters });
  const list = clusters.data ?? [];
  const effectiveCluster = list.find((c) => c.status === "connected")?.id || list[0]?.id || "";

  const [nsFilter, setNsFilter] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [selected, setSelected] = useState<{ ns: string; name: string } | null>(null);

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

  const cols = useMemo(
    () => Object.keys(def ? extraColumns(def.slug, { nodeUsage, podsPerNode }) : {}),
    [def, nodeUsage, podsPerNode],
  );

  function cellFor(slug: string, col: string, o: Row): Cell {
    return extraColumns(slug, { nodeUsage, podsPerNode })[col]?.(o) ?? { v: "" };
  }

  const rows = useMemo(() => {
    let out = [...stream.rows];
    if (search) {
      out = out.filter((r) => str(rec(r.metadata).name).includes(search));
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

  if (!def) {
    return (
      <div className="page">
        <div className="empty-state">
          <p>Unknown resource “{kind}”.</p>
        </div>
      </div>
    );
  }

  const headers = ["Name", ...(def.scoped ? [] : ["Namespace"]), ...cols, "Age"];

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          {def.label}
          {stream.synced && (
            <span className="live-pill">● live</span>
          )}
        </h2>
        <Badge>{rows.length}</Badge>
      </div>

      <div className="toolbar">
        <select className="toolbar-select" value={effectiveCluster} onChange={() => undefined} aria-label="cluster">
          {list.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id}
            </option>
          ))}
        </select>
        {!def.scoped && (
          <NamespaceFilter
            cluster={effectiveCluster || undefined}
            selected={nsFilter}
            onChange={setNsFilter}
          />
        )}
        <input
          className="toolbar-input"
          placeholder={`Filter ${def.label.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
      </div>

      {!stream.synced ? (
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {[0, 1, 2, 3, 4].map((i) => (
                <tr key={i}>
                  {headers.map((_, j) => (
                    <td key={j}>
                      <Skeleton w={[150, 90, 60, 70, 60, 50][j % 6]} />
                    </td>
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
        <div className="table-wrap">
          <table className="kb-table">
            <thead>
              <tr>
                {headers.map((h) => (
                  <th key={h} className={h ? "th-sortable" : ""} onClick={() => {
                    if (!h) return;
                    if (sortCol === h) setSortAsc(!sortAsc);
                    else { setSortCol(h); setSortAsc(true); }
                  }}>
                    {h}
                    {sortCol === h && <span className="sort-indicator">{sortAsc ? " ↑" : " ↓"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const meta = rec(o.metadata);
                const name = str(meta.name);
                const key = `${str(meta.namespace)}/${name}`;
                return (
                  <tr key={key} className="row-clickable" onClick={() => setSelected({ ns: str(meta.namespace), name })}>
                    <td className="mono strong">{name}</td>
                    {!def.scoped && <td className="mono muted">{str(meta.namespace)}</td>}
                    {cols.map((col) => {
                      const cell = cellFor(def.slug, col, o);
                      return (
                        <td key={col} className="mono muted">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                            {cell.dot ? healthDot(cell.dot) : null}
                            <span style={{ color: cell.cls }}>{cell.v}</span>
                          </span>
                        </td>
                      );
                    })}
                    <td className="mono muted">{fmtAge(ageOf(o))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <GenericDrawer
          cluster={effectiveCluster}
          def={def}
          ns={selected.ns}
          name={selected.name}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
