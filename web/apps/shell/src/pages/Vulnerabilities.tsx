import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, Drawer, EmptyState, IconButton, PageHeader, Row, TextField, type Column } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { PageLoader } from "../components/PageLoader";
import { InstallTrivyOperator } from "../components/InstallTrivyOperator";
import { VulnFindingsSummary } from "../components/PodVulnerabilitiesTab";
import { crdApi } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { detectTrivyOperator } from "../lib/trivyOperator";
import { absoluteTime } from "../lib/tableUx";
import { fmtAge, slugForKind } from "../lib/resources";
import {
  matchesVulnQuery,
  replicaSetDeployments,
  severityCounts,
  vulnOwner,
  vulnWorkloads,
  type VulnWorkload,
} from "../lib/vulnFindings";

const COLUMNS: Column<VulnWorkload>[] = [
  { key: "name", header: "Workload", render: (w) => w.name, className: "mono td-name", title: (w) => w.name },
  { key: "kind", header: "Kind", render: (w) => w.kind, className: "cell-secondary" },
  { key: "ns", header: "Namespace", render: (w) => w.ns, className: "mono" },
  { key: "critical", header: "Critical", render: (w) => w.counts.CRITICAL, className: "mono" },
  { key: "high", header: "High", render: (w) => w.counts.HIGH, className: "mono" },
  { key: "medium", header: "Medium", render: (w) => w.counts.MEDIUM, className: "mono" },
  { key: "low", header: "Low", render: (w) => w.counts.LOW, className: "mono" },
  { key: "fixable", header: "Fixable", render: (w) => w.fixable, className: "mono" },
  { key: "images", header: "Images", render: (w) => w.images.join(", "), className: "mono cell-secondary", title: (w) => w.images.join("\n") },
  {
    key: "scanned",
    header: "Scanned",
    render: (w) => (w.scannedAt ? fmtAge(Date.now() - Date.parse(w.scannedAt)) : "–"),
    className: "mono cell-secondary",
    title: (w) => (w.scannedAt ? absoluteTime(w.scannedAt) : undefined),
  },
];

/** `namespace/Kind/name` as the page's row key; a ReplicaSet's is its Deployment's. */
function rowKeyFor(link: string, rsDeployment: Map<string, string>): string {
  const [ns = "", kind = "", ...rest] = link.split("/");
  const owner = vulnOwner(kind, rest.join("/"), ns, rsDeployment);
  return `${ns}/${owner.kind}/${owner.name}`;
}

/**
 * Root backlog #16: every CVE Trivy-Operator has found, on one page, a row per
 * workload, worst first. A row opens the workload's findings in a drawer;
 * `?workload=namespace/Kind/name` (a pod's or workload's own drawer links
 * here) opens one directly.
 */
export default function Vulnerabilities() {
  const { cluster } = useCluster();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(() => sp.get("workload"));
  const nsFilter = useSelectedNamespaces(cluster || undefined);

  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const detection = useMemo(() => detectTrivyOperator(crds.data ?? []), [crds.data]);
  const gvr = detection.vulnerabilityReportGvr;
  const ns = nsFilter.length > 0 ? nsFilter : undefined;

  const reports = useResourceStream(gvr ? cluster : undefined, gvr ?? "", { ns, mode: "full", enabled: !!gvr });
  // Metadata is enough to map a ReplicaSet to its Deployment.
  const replicaSets = useResourceStream(gvr ? cluster : undefined, "apps/v1/replicasets", { ns, mode: "metadata", enabled: !!gvr });

  const all = useMemo(() => vulnWorkloads(reports.rows, replicaSets.rows), [reports.rows, replicaSets.rows]);
  const rows = useMemo(() => all.filter((w) => matchesVulnQuery(w, query)), [all, query]);
  const totals = useMemo(() => severityCounts(rows.flatMap((w) => w.findings)), [rows]);
  const rsDeployment = useMemo(() => replicaSetDeployments(replicaSets.rows), [replicaSets.rows]);
  const openRow = open ? all.find((w) => w.key === rowKeyFor(open, rsDeployment)) : undefined;

  const close = () => {
    setOpen(null);
    if (sp.has("workload")) {
      const next = new URLSearchParams(sp);
      next.delete("workload");
      setSp(next, { replace: true });
    }
  };

  const header = (count?: string) => <PageHeader help={<PageHelp route="/vulnerabilities" />} level={2} title="Vulnerabilities" count={count} live={reports.synced && reports.connected} />;

  if (!cluster) {
    return (
      <div className="page">
        {header()}
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }
  if (crds.isLoading) {
    return (
      <div className="page">
        {header()}
        <PageLoader message="Checking for Trivy-Operator…" />
      </div>
    );
  }
  if (!detection.installed) {
    return (
      <div className="page">
        {header()}
        <EmptyState>
          <p>Trivy-Operator not detected on this cluster. It scans the cluster's images and reports what it finds here.</p>
          <InstallTrivyOperator cluster={cluster} />
        </EmptyState>
      </div>
    );
  }

  const filtered = query.trim() !== "";
  return (
    <div className="page">
      {header(filtered ? `· ${rows.length} of ${all.length} workloads` : `· ${all.length} workloads`)}
      <Row gap={2} align="center" style={{ marginBottom: 10 }}>
        <NamespaceFilter cluster={cluster} />
        <TextField
          aria-label="Filter vulnerabilities"
          placeholder="Filter by workload, image, CVE or package…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          style={{ flex: "1 1 240px", maxWidth: 360 }}
        />
        <span className="muted small">
          {totals.CRITICAL} critical · {totals.HIGH} high · {totals.MEDIUM} medium · {totals.LOW} low
        </span>
      </Row>

      <DataTable
        columns={COLUMNS}
        rows={rows}
        rowKey={(w) => w.key}
        onRowClick={(w) => setOpen(w.key)}
        loading={!reports.synced && reports.rows.length === 0}
        loadingLabel="Loading vulnerability reports…"
        empty={
          <EmptyState>
            <p>{filtered ? "No workload matches." : "No vulnerabilities found."}</p>
            <p className="muted small">
              {filtered ? "Loosen the filter." : "Trivy-Operator scans each workload's images; a new one shows up here once it has been scanned."}
            </p>
          </EmptyState>
        }
      />

      {openRow && (
        <Drawer
          title={openRow.name}
          subtitle={`${openRow.kind} · ${openRow.ns}`}
          onClose={close}
          actions={
            <>
              {slugForKind(openRow.kind) && (
                <Button variant="ghost" onClick={() => navigate(`/detail/${slugForKind(openRow.kind)}/${openRow.ns}/${openRow.name}`)}>
                  Open workload
                </Button>
              )}
              <IconButton label="Close" onClick={close}>
                ×
              </IconButton>
            </>
          }
        >
          <VulnFindingsSummary findings={openRow.findings} emptyLabel="this workload" />
        </Drawer>
      )}
    </div>
  );
}
