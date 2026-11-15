import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, DataTable, InlineBanner, Modal, Row, Spinner, Stack } from "@kubebay/ui";
import { api, discoveryApi } from "../lib/api";
import { buildFindingsReport, reportToJSON, reportToMarkdown, reportToSARIF, type DetectorFindings, type FindingsReport } from "../lib/findingsReport";
import { findNetworkPolicyCoverageGaps } from "../lib/networkPolicyCoverage";
import { computeSpofFindings } from "../lib/spof";
import { computeUpgradeReadiness } from "../lib/upgradeReadiness";
import { useCluster } from "../lib/useCluster";
import { useResourceStream } from "../lib/useResourceStream";

type Rows = Record<string, unknown>[];

export interface FindingsExportProps {
  cluster: string;
  /** The page's own streams and RBAC analysis have loaded. */
  ready: boolean;
  /** Findings the page has already computed. */
  findings: Pick<DetectorFindings, "rbac" | "attackPaths" | "secretEnv" | "automount" | "unenforcedSignatureNamespaces">;
  /** Objects the page already streams, reused for SPOF and NetworkPolicy coverage. */
  rows: { pods: Rows; deployments: Rows; statefulSets: Rows; services: Rows; networkPolicies: Rows };
}

const FORMATS = [
  { label: "SARIF", ext: "sarif", type: "application/sarif+json", write: reportToSARIF },
  { label: "JSON", ext: "json", type: "application/json", write: reportToJSON },
  { label: "Markdown", ext: "md", type: "text/markdown", write: reportToMarkdown },
] as const;

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function save(name: string, type: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * KB-15: one report of every detector's findings for this cluster, saved as
 * SARIF, JSON or Markdown to share without a server. The page's own findings
 * are reused; SPOF and upgrade readiness need a few more objects, which load
 * only while this dialog is open.
 */
export function FindingsExport({ cluster, ready, findings, rows }: FindingsExportProps) {
  const [open, setOpen] = useState(false);
  const { list } = useCluster();
  const serverVersion = list.find((c) => c.id === cluster)?.version;
  const pdbs = useResourceStream(open ? cluster : undefined, "policy/v1/poddisruptionbudgets", { mode: "full", enabled: open });
  const slices = useResourceStream(open ? cluster : undefined, "discovery.k8s.io/v1/endpointslices", { mode: "full", enabled: open });
  const apiVersions = useQuery({
    queryKey: ["apiversions", cluster],
    queryFn: () => discoveryApi.apiVersions(cluster),
    enabled: open && !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const engine = useQuery({ queryKey: ["engine-version"], queryFn: api.version, enabled: open, staleTime: Infinity, retry: false });

  const all = useMemo<DetectorFindings>(
    () =>
      open
        ? {
            ...findings,
            spof: computeSpofFindings({ deployments: rows.deployments, statefulSets: rows.statefulSets, pdbs: pdbs.rows, pods: rows.pods, services: rows.services, endpointSlices: slices.rows }),
            netpolGaps: findNetworkPolicyCoverageGaps(rows.pods, rows.networkPolicies),
            upgrade: serverVersion ? computeUpgradeReadiness(serverVersion, apiVersions.data ?? []) : [],
          }
        : {},
    [open, findings, rows, pdbs.rows, slices.rows, serverVersion, apiVersions.data],
  );
  const gathering = !ready || !pdbs.synced || !slices.synced || apiVersions.isLoading || engine.isLoading;
  const report = (at: Date): FindingsReport =>
    buildFindingsReport({ cluster, kubebayVersion: engine.data?.version || "dev", generatedAt: at.toISOString(), findings: all });
  const preview = report(new Date(0));
  const high = preview.findings.filter((f) => f.severity === "high").length;
  const detectors = [...new Set(preview.findings.map((f) => f.detector))].map((d) => {
    const of = preview.findings.filter((f) => f.detector === d);
    return { detector: d, high: of.filter((f) => f.severity === "high").length, medium: of.filter((f) => f.severity !== "high").length };
  });

  return (
    <>
      <Button variant="ghost" disabled={!cluster} onClick={() => setOpen(true)}>
        Export report
      </Button>
      {open && (
        <Modal label="Export findings report" title="Export findings report" placement="center" onClose={() => setOpen(false)}>
          <Stack gap={3}>
            <div className="muted small">
              Every finding Kubebay&apos;s detectors have for this cluster: attack paths, RBAC, upgrade readiness, single points
              of failure, NetworkPolicy coverage, secrets in environment variables, mounted ServiceAccount tokens and image
              signature enforcement, with CIS and ATT&amp;CK control IDs. SARIF opens in code-scanning tools; the report
              names the cluster, the time and the Kubebay version. Built-in system bindings are left out, as on this page. The file
              is saved on this machine and sent nowhere.
            </div>
            {gathering ? (
              <Row gap={2} align="center">
                <Spinner label="Gathering findings…" size={16} />
                <span className="muted small">Gathering findings…</span>
              </Row>
            ) : (
              <Stack gap={2}>
                <div className="strong">{`${preview.findings.length} finding${preview.findings.length === 1 ? "" : "s"}, ${high} high`}</div>
                {detectors.length > 0 && (
                  <DataTable
                    rows={detectors}
                    rowKey={(d) => d.detector}
                    columns={[
                      { key: "detector", header: "Detector", render: (d) => d.detector },
                      { key: "high", header: "High", className: "mono small", render: (d) => d.high },
                      { key: "medium", header: "Medium", className: "mono small", render: (d) => d.medium },
                    ]}
                  />
                )}
              </Stack>
            )}
            {apiVersions.error && <InlineBanner tone="warn" flush>Upgrade readiness is missing: the served API versions couldn&apos;t be read.</InlineBanner>}
            <Row gap={2} wrap>
              {FORMATS.map((f) => (
                <Button
                  key={f.ext}
                  disabled={gathering}
                  onClick={() => {
                    const at = new Date();
                    save(`kubebay-findings-${cluster.replace(/[^A-Za-z0-9._-]+/g, "-")}-${stamp(at)}.${f.ext}`, f.type, f.write(report(at)));
                  }}
                >
                  {`Save ${f.label}`}
                </Button>
              ))}
            </Row>
          </Stack>
        </Modal>
      )}
    </>
  );
}
