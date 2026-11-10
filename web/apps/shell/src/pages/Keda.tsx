import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button, CellLink, EmptyState, InlineBanner, PageHeader, StatusDot, Tabs } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import type { ListColumn } from "../components/ResourceListView";
import { ResourceTableView } from "./ResourceTable";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { extSlug, lookupDef, slugForKind, type ResourceDef } from "../lib/resources";
import { authUsers, detectKeda, explainScaledObject, hpaConflictsWithScaledObject, kedaPause, type KedaKind } from "../lib/keda";

type Row = Record<string, unknown>;

const LABELS: Record<KedaKind, string> = {
  scaledobjects: "ScaledObjects",
  scaledjobs: "ScaledJobs",
  triggerauthentications: "TriggerAuthentications",
  clustertriggerauthentications: "ClusterTriggerAuthentications",
};
const KINDS: Record<KedaKind, string> = {
  scaledobjects: "ScaledObject",
  scaledjobs: "ScaledJob",
  triggerauthentications: "TriggerAuthentication",
  clustertriggerauthentications: "ClusterTriggerAuthentication",
};
// KEDA's own printer columns that a column here shows better: Paused reads
// only the condition, the target is one linked column.
const HIDDEN_PRINTER_COLUMNS = ["Paused", "ScaleTargetKind", "ScaleTargetName"];

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

function dotted(dot: string | null, text: string): ReactNode {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      {dot && <StatusDot status={dot} />}
      {text}
    </span>
  );
}

const pausedColumn: ListColumn<Row> = {
  id: "Paused",
  header: "Paused",
  width: 170,
  className: "",
  cell: (o) => {
    const p = kedaPause(o);
    return p.paused ? dotted("degraded", p.label) : <span className="muted">No</span>;
  },
  sortValue: (o) => kedaPause(o).label,
  filterText: (o) => kedaPause(o).label,
  filterKey: "paused",
};

/**
 * KEDA (root backlog #25): each KEDA kind in the same table as its CRD's own
 * page (filter language, namespace filter, columns, saved views, row menu,
 * drawer), with KEDA's checks as columns: whether it's paused (#24), whether
 * an HPA also scales its target, and whether a TriggerAuthentication is used.
 * A workload's own Autoscaling tab still explains and creates ScaledObjects.
 */
export default function Keda() {
  const { cluster: effectiveCluster } = useCluster();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const crds = useQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const detection = useMemo(() => detectKeda(crds.data ?? []), [crds.data]);
  const kinds = (Object.keys(LABELS) as KedaKind[]).filter((k) => detection.gvrs[k]);
  const tab: KedaKind = kinds.find((k) => k === sp.get("tab")) ?? "scaledobjects";

  // What the columns compare against: HPAs for conflicts, ScaledObjects and
  // ScaledJobs for which authentications are in use.
  const authTab = tab === "triggerauthentications" || tab === "clustertriggerauthentications";
  const hpas = useResourceStream(effectiveCluster || undefined, "autoscaling/v2/horizontalpodautoscalers", {
    mode: "full",
    enabled: tab === "scaledobjects" && !!detection.gvrs.scaledobjects,
  });
  const scaledObjects = useResourceStream(effectiveCluster || undefined, detection.gvrs.scaledobjects ?? "", {
    mode: "full",
    enabled: (tab === "scaledobjects" || authTab) && !!detection.gvrs.scaledobjects,
  });
  const scaledJobs = useResourceStream(effectiveCluster || undefined, detection.gvrs.scaledjobs ?? "", {
    mode: "full",
    enabled: authTab && !!detection.gvrs.scaledjobs,
  });

  // An HPA in the ScaledObject's namespace that scales the same workload.
  const conflictOf = useMemo(() => {
    const byNs = new Map<string, Row[]>();
    for (const h of hpas.rows) {
      const ns = String(rec(h.metadata).namespace ?? "");
      byNs.set(ns, [...(byNs.get(ns) ?? []), h]);
    }
    return (o: Row) => (hpaConflictsWithScaledObject(o, byNs.get(String(rec(o.metadata).namespace ?? "")) ?? []) ? "Yes" : "No");
  }, [hpas.rows]);

  const columns = useMemo<ListColumn<Row>[]>(() => {
    if (tab === "scaledobjects") {
      const conflict = conflictOf;
      return [
        {
          id: "Target",
          header: "Target",
          width: 200,
          className: "mono",
          cell: (o) => {
            const e = explainScaledObject(o);
            const slug = slugForKind(e.targetKind);
            const text = `${e.targetKind}/${e.targetName}`;
            if (!slug || !e.targetName) return text;
            const to = `/detail/${slug}/${e.ns || "_"}/${e.targetName}`;
            return (
              <CellLink
                href={to}
                onClick={(ev) => {
                  ev.preventDefault();
                  ev.stopPropagation();
                  navigate(to);
                }}
              >
                {text}
              </CellLink>
            );
          },
          sortValue: (o) => `${explainScaledObject(o).targetKind}/${explainScaledObject(o).targetName}`,
          filterText: (o) => `${explainScaledObject(o).targetKind}/${explainScaledObject(o).targetName}`,
          filterKey: "target",
        },
        {
          id: "Scales on",
          header: "Scales on",
          width: 200,
          className: "",
          cell: (o) => explainScaledObject(o).triggerDescriptions.map((d) => d.replace(/^on /, "")).join(", ") || "–",
          sortValue: (o) => explainScaledObject(o).triggerDescriptions.join(", "),
          filterText: (o) => explainScaledObject(o).triggerDescriptions.join(", "),
          filterKey: "scales-on",
        },
        pausedColumn,
        {
          id: "HPA conflict",
          header: "HPA conflict",
          width: 120,
          className: "",
          cell: (o) => (conflict(o) === "Yes" ? dotted("unreachable", "Yes") : <span className="muted">No</span>),
          sortValue: conflict,
          filterText: conflict,
          filterKey: "hpa-conflict",
        },
      ];
    }
    if (tab === "scaledjobs") return [pausedColumn];
    const users = (o: Row) => authUsers(o, tab === "clustertriggerauthentications", [...scaledObjects.rows, ...scaledJobs.rows]);
    const inUse = (o: Row) => (users(o) > 0 ? `Yes (${users(o)})` : "No");
    return [
      {
        id: "In use",
        header: "In use",
        width: 110,
        className: "",
        cell: (o) => (users(o) > 0 ? inUse(o) : dotted("degraded", "No")),
        sortValue: (o) => users(o),
        filterText: inUse,
        filterKey: "in-use",
      },
    ];
  }, [tab, conflictOf, scaledObjects.rows, scaledJobs.rows, navigate]);

  const header = (
    <PageHeader help={<PageHelp route="/keda" />} level={2} title="KEDA" />
  );

  if (!effectiveCluster) {
    return (
      <div className="page">
        {header}
        <EmptyState>
          <p>Select a cluster first.</p>
        </EmptyState>
      </div>
    );
  }

  if (crds.isLoading) {
    return (
      <div className="page">
        {header}
        <PageLoader message="Checking for KEDA…" />
      </div>
    );
  }

  if (!detection.installed) {
    return (
      <div className="page">
        {header}
        <div className="page-body">
          <EmptyState>
            <p>KEDA not detected on this cluster.</p>
            <p className="muted small">
              This page lists an existing KEDA install&apos;s objects, and found no ScaledObject CRD
              (<code className="mono">scaledobjects.keda.sh</code>). Kubebay doesn&apos;t install KEDA. A Deployment&apos;s or
              StatefulSet&apos;s Autoscaling tab still shows its HPAs and VPAs.
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  const gvr = detection.gvrs[tab]!;
  const slug = `ext--${extSlug(gvr)}`;
  const base = lookupDef(slug, new URLSearchParams({ scoped: tab === "clustertriggerauthentications" ? "0" : "1" }))!;
  const def: ResourceDef = { ...base, label: LABELS[tab], kind: KINDS[tab] };

  const conflicts = tab === "scaledobjects" ? scaledObjects.rows.filter((o) => conflictOf(o) === "Yes").length : 0;
  const show = (q: string) => setSp({ tab, q }, { replace: true });

  return (
    <ResourceTableView
      key={tab}
      kind={slug}
      def={def}
      title="KEDA"
      titleCount={`· ${LABELS[tab]}`}
      help={<PageHelp route="/keda" />}
      leadColumns={columns}
      hidePrinterColumns={HIDDEN_PRINTER_COLUMNS}
      above={
        <Tabs
          tabs={kinds}
          labels={LABELS}
          active={tab}
          onChange={(t) => setSp({ tab: t }, { replace: true })}
        />
      }
      banner={
        conflicts > 0 && (
          <InlineBanner tone="warn" actions={<Button variant="ghost" onClick={() => show("hpa-conflict:yes")}>Show them</Button>}>
            {conflicts === 1 ? "1 ScaledObject is" : `${conflicts} ScaledObjects are`} also scaled by an HPA. The two fight over the
            replica count: remove one.
          </InlineBanner>
        )
      }
    />
  );
}
