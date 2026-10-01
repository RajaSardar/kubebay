import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, useLocation } from "react-router-dom";
import { EmptyState, StatusDot } from "@kubebay/ui";
import { api, crdApi, type PrinterColumn } from "../lib/api";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";
import { fmtAge, lookupDef, num, str, type ResourceDef } from "../lib/resources";
import { fmtBytes, fmtCpu } from "../lib/format";
import { useNodeExtras } from "../lib/useNodeExtras";
import { evalPrinterPath } from "../lib/printerPath";
import { ownerOf, ownerLabel } from "../lib/gitops";
import { templateKindFor } from "../lib/resourceTemplates";
import { podsOfWorkloadPath } from "../lib/selector";
import { ResourceListView, type ListColumn } from "../components/ResourceListView";

import GenericDrawer from "../components/GenericDrawer";
import { WorkloadActionDialog, workloadActions } from "../components/WorkloadActionDialog";
import { StarButton } from "../components/Favorites";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { useSelectedNamespaces } from "../lib/namespace-store";
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
      NodePool: (o) => ({ v: str((rec(o.metadata).labels as Record<string, unknown> | undefined)?.["karpenter.sh/nodepool"]) || "–" }),
      "Capacity type": (o) => ({ v: str((rec(o.metadata).labels as Record<string, unknown> | undefined)?.["karpenter.sh/capacity-type"]) || "–" }),
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
    case "policyreports":
    case "clusterpolicyreports":
      return {
        Summary: (o) => {
          const s = o.summary as Record<string, unknown> | undefined;
          if (!s) return { v: "–" };
          const pass = num(s.pass);
          const fail = num(s.fail);
          const warn = num(s.warn);
          const error = num(s.error);
          const parts: string[] = [];
          if (pass) parts.push(`${pass} pass`);
          if (fail) parts.push(`${fail} fail`);
          if (warn) parts.push(`${warn} warn`);
          if (error) parts.push(`${error} error`);
          const dot: Cell["dot"] = fail || error ? "err" : warn ? "warn" : "ok";
          return { v: parts.length > 0 ? parts.join(", ") : "0 results", dot };
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

// Universal (not per-slug) column: any resource kind can be GitOps-managed.
export function ownerCell(o: Row): Cell {
  const owner = ownerOf(o);
  return owner ? { v: ownerLabel(owner), cls: "muted" } : { v: "–", cls: "muted" };
}

const nameOf = (r: Row) => str(rec(r.metadata).name);
const nsOf = (r: Row) => str(rec(r.metadata).namespace);
const createdOf = (r: Row) => str(rec(r.metadata).creationTimestamp);
const isTerminating = (r: Row) => !!rec(r.metadata).deletionTimestamp;
/** Kinds whose row menu offers "Show pods" (they select pods by label). */
const HAS_PODS = new Set(["deployments", "statefulsets", "daemonsets", "replicasets", "jobs"]);

export default function ResourceTable() {
  const { kind = "" } = useParams();
  const [sp] = useSearchParams();
  const def: ResourceDef | undefined = lookupDef(kind, sp);
  const navigate = useNavigate();

  const location = useLocation();
  const { cluster: effectiveCluster } = useCluster();

  const nsFilter = useSelectedNamespaces(effectiveCluster || undefined);
  const [selected, setSelected] = useState<{ ns: string; name: string; tab?: "yaml" } | null>(null);
  const [rowAction, setRowAction] = useState<{ action: "scale" | "restart"; obj: Row } | null>(null);

  const stream = useResourceStream(effectiveCluster || undefined, def?.gvr ?? "v1/configmaps", {
    mode: def?.mode,
    ns: def && !def.scoped && nsFilter.length > 0 ? nsFilter : undefined,
  });

  const { nodeUsage, podsPerNode } = useNodeExtras(effectiveCluster, def?.slug === "nodes");

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

  // The kind's columns, then CRD printer columns, then Owner. The filter
  // matches, and headers sort by, every one of them.
  const columns = useMemo<ListColumn<Row>[]>(() => {
    const extra = def ? extraColumns(def.slug, { nodeUsage, podsPerNode }) : {};
    return [
      ...Object.entries(extra).map(([col, cellOf]): ListColumn<Row> => ({
        id: col,
        header: col,
        sortValue: (o) => cellOf(o).v,
        filterText: (o) => String(cellOf(o).v),
        cell: (o) => {
          const cell = cellOf(o);
          return (
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
          );
        },
      })),
      ...printerColumns.map((pc): ListColumn<Row> => ({
        id: pc.name,
        header: pc.name,
        cell: (o) => evalPrinterPath(pc.jsonPath, o) || <span className="muted">–</span>,
        sortValue: (o) => evalPrinterPath(pc.jsonPath, o),
        filterText: (o) => evalPrinterPath(pc.jsonPath, o),
      })),
      {
        id: "Owner",
        header: "Owner",
        cell: (o) => ownerCell(o).v,
        sortValue: (o) => ownerCell(o).v,
        filterText: (o) => ownerCell(o).v,
      },
    ];
  }, [def, nodeUsage, podsPerNode, printerColumns, navigate]);

  const onOpen = useCallback((r: Row) => setSelected({ ns: nsOf(r), name: nameOf(r) }), []);

  if (!def) {
    return (
      <div className="page">
        <EmptyState>
          <p>Unknown resource "{kind}".</p>
        </EmptyState>
      </div>
    );
  }

  const createKind = templateKindFor(def.slug);

  return (
    <div className="page">
      {isWorkloadRoute(location.pathname) && <WorkloadTabBar />}
      <ResourceListView<Row>
        title={
          <>
            {def.label}
            <StarButton path={`/r/${kind}`} />
          </>
        }
        label={def.label}
        rows={stream.rows}
        objects={stream.rows}
        synced={stream.synced}
        busy={!stream.synced}
        live={stream.synced}
        cluster={effectiveCluster}
        scoped={def.scoped}
        nsFiltered={nsFilter.length > 0}
        nameOf={nameOf}
        nsOf={nsOf}
        createdOf={createdOf}
        isDimmed={isTerminating}
        columns={columns}
        sortKey={`r/${kind}`}
        onOpen={onOpen}
        toolbar={!def.scoped && <NamespaceFilter cluster={effectiveCluster || undefined} />}
        onDelete={(t, gitopsOwner) =>
          api.deleteResource({ cluster: effectiveCluster, gvr: def.gvr, ns: t.ns, name: t.name, gitopsOwner })
        }
        menuItems={(o, { requestDelete }) => {
          const ns = nsOf(o);
          const name = nameOf(o);
          return [
            { label: "View details", onClick: () => setSelected({ ns, name }) },
            { label: "Edit YAML", onClick: () => setSelected({ ns, name, tab: "yaml" }) },
            ...(HAS_PODS.has(def.slug)
              ? [
                  (() => {
                    const to = podsOfWorkloadPath(o, def.kind);
                    return { label: "Show pods", disabled: !to, onClick: () => to && navigate(to) };
                  })(),
                ]
              : []),
            ...(workloadActions(def.slug).scale ? [{ label: "Scale…", onClick: () => setRowAction({ action: "scale", obj: o }) }] : []),
            ...(workloadActions(def.slug).restart ? [{ label: "Restart…", onClick: () => setRowAction({ action: "restart", obj: o }) }] : []),
            { label: "Copy name", onClick: () => void navigator.clipboard?.writeText(name) },
            { separator: true, label: "", onClick: () => {} },
            { label: "Delete", danger: true, onClick: requestDelete },
          ];
        }}
      />

      {rowAction && (
        <WorkloadActionDialog
          action={rowAction.action}
          slug={def.slug}
          cluster={effectiveCluster}
          obj={rowAction.obj}
          onClose={() => setRowAction(null)}
        />
      )}

      {selected && (
        <GenericDrawer
          key={`${selected.ns}/${selected.name}/${selected.tab ?? ""}`}
          cluster={effectiveCluster}
          def={def}
          ns={selected.ns}
          name={selected.name}
          initialTab={selected.tab}
          onClose={() => setSelected(null)}
          onPopOut={() => {
            setSelected(null);
            navigate(`/detail/${kind}/${selected.ns || "_"}/${selected.name}${sp.toString() ? "?" + sp.toString() : ""}`);
          }}
        />
      )}

      {/* "+" — create one of these, starting from its template */}
      {createKind && (
        <button
          className="resource-fab"
          aria-label={`Create ${def.label}`}
          title={`Create ${createKind}`}
          onClick={() => navigate(`/create-resource?kind=${createKind}`)}
        >
          +
        </button>
      )}
    </div>
  );
}
