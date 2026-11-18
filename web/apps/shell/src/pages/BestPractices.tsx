import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, CollapsibleSection, EmptyState, PageHeader, Row, Select, Stack, type BadgeTone } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { discoveryApi } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { useResourceStream, type StreamState } from "../lib/useResourceStream";
import {
  SEVERITIES,
  computeBestPractices,
  filterChecks,
  sortChecks,
  summarize,
  type BestPracticeCheck,
  type CheckGroup,
  type CheckStatus,
  type Severity,
  type SortKey,
} from "../lib/bestPractices";

const GROUP_ORDER: CheckGroup[] = ["Reliability", "Security", "Disaster recovery", "Platform"];
const STATUS_TONE: Record<CheckStatus, BadgeTone | undefined> = { pass: "ok", fail: "warn", unknown: undefined };
const SEVERITY_TONE: Record<Severity, BadgeTone | undefined> = { Critical: "err", High: "warn", Medium: "info", Low: undefined };
const STATUS_LABEL: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", unknown: "Unknown" };

/** The stream's rows once it has them; undefined while it can't give any (RBAC forbids it, or it hasn't synced). */
function rowsOf(s: StreamState): Record<string, unknown>[] | undefined {
  if (s.forbidden) return undefined;
  return s.synced ? s.rows : undefined;
}

function CheckCard({ check }: { check: BestPracticeCheck }) {
  const [open, setOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  return (
    <Card>
      <Stack gap={1}>
        <Row align="center" gap={2} wrap>
          <Badge tone={STATUS_TONE[check.status]}>{STATUS_LABEL[check.status]}</Badge>
          <Badge tone={SEVERITY_TONE[check.severity]}>{check.severity}</Badge>
          <strong>{check.title}</strong>
        </Row>
        <div className="small">{check.detail}</div>
        {check.offenders && check.offenders.length > 0 && (
          <div className="small mono muted">e.g. {check.offenders.join(", ")}</div>
        )}
        <div className="small muted">Why it matters: {check.why}</div>
        {check.link && check.status === "pass" && (
          <div className="small">
            <Link to={check.link}>{check.linkLabel ?? "Open"}</Link>
          </div>
        )}
        {check.link && check.status === "fail" && !check.install && (
          <div className="small">
            <Link to={check.link}>{check.linkLabel ?? "Open"}</Link>
          </div>
        )}
        <CollapsibleSection title="Learn" level="sub" open={learnOpen} onToggle={() => setLearnOpen((o) => !o)}>
          <Stack gap={1}>
            <div className="small">{check.learn.text}</div>
            <div className="small muted">
              Official docs: <span className="mono">{check.learn.docsUrl}</span>
            </div>
          </Stack>
        </CollapsibleSection>
        {check.install && (
          <CollapsibleSection title="How to install" level="sub" open={open} onToggle={() => setOpen((o) => !o)}>
            <Stack gap={1}>
              <div className="small muted">
                {check.install.tool}'s own instructions, as text only. Kubebay doesn't run these; copy them to your terminal.
              </div>
              {check.install.commands.map((c) => (
                <code key={c} className="mono small" style={{ display: "block", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {c}
                </code>
              ))}
              <a className="small" href={check.install.docsUrl} target="_blank" rel="noreferrer">
                Official install guide
              </a>
            </Stack>
          </CollapsibleSection>
        )}
      </Stack>
    </Card>
  );
}

/**
 * Backlog #36: a best-practices checklist for the connected cluster, built from
 * what the app already streams plus API discovery. Read-only: it never installs
 * anything, it shows the install command as text.
 */
export default function BestPractices() {
  const { cluster } = useCluster();
  const c = cluster || undefined;
  const deployments = useResourceStream(c, "apps/v1/deployments", { mode: "full" });
  const statefulsets = useResourceStream(c, "apps/v1/statefulsets", { mode: "full" });
  const pdbs = useResourceStream(c, "policy/v1/poddisruptionbudgets", { mode: "full" });
  const netpols = useResourceStream(c, "networking.k8s.io/v1/networkpolicies", { mode: "full" });
  const namespaces = useResourceStream(c, "v1/namespaces", { mode: "full" });
  const ingressClasses = useResourceStream(c, "networking.k8s.io/v1/ingressclasses", { mode: "full" });
  const services = useResourceStream(c, "v1/services", { mode: "full" });
  const pvcs = useResourceStream(c, "v1/persistentvolumeclaims", { mode: "full" });
  const nodes = useResourceStream(c, "v1/nodes", { mode: "full" });
  const hpas = useResourceStream(c, "autoscaling/v2/horizontalpodautoscalers", { mode: "full" });
  const apisQ = useQuery({
    queryKey: ["apis", cluster],
    queryFn: () => discoveryApi.apis(cluster!),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const apiGroups = apisQ.data ? [...new Set(apisQ.data.map((a) => a.group))] : undefined;
  // The CRD streams open only when discovery lists the group; they never hold the page back.
  const hasCerts = !!apiGroups?.includes("cert-manager.io");
  const hasVelero = !!apiGroups?.includes("velero.io");
  const certs = useResourceStream(c, "cert-manager.io/v1/certificates", { mode: "full", enabled: hasCerts });
  const schedules = useResourceStream(c, "velero.io/v1/schedules", { mode: "full", enabled: hasVelero });

  const streams = [deployments, statefulsets, pdbs, netpols, namespaces, ingressClasses, services, pvcs, nodes, hpas];
  const waiting = streams.some((s) => !s.forbidden && !s.synced) || apisQ.isLoading;

  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<CheckStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("group");

  const checks = useMemo(
    () =>
      computeBestPractices({
        deployments: rowsOf(deployments),
        statefulsets: rowsOf(statefulsets),
        pdbs: rowsOf(pdbs),
        networkPolicies: rowsOf(netpols),
        namespaces: rowsOf(namespaces),
        ingressClasses: rowsOf(ingressClasses),
        apiGroups,
        services: rowsOf(services),
        pvcs: rowsOf(pvcs),
        nodes: rowsOf(nodes),
        hpas: rowsOf(hpas),
        certificates: apiGroups ? (hasCerts ? rowsOf(certs) : []) : undefined,
        veleroSchedules: apiGroups ? (hasVelero ? rowsOf(schedules) : []) : undefined,
      }),
    // The streams' state objects change on every flush; their rows are what the checks read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployments.rows, deployments.synced, deployments.forbidden, statefulsets.rows, statefulsets.synced, statefulsets.forbidden, pdbs.rows, pdbs.synced, pdbs.forbidden, netpols.rows, netpols.synced, netpols.forbidden, namespaces.rows, namespaces.synced, namespaces.forbidden, ingressClasses.rows, ingressClasses.synced, ingressClasses.forbidden, services.rows, services.synced, services.forbidden, pvcs.rows, pvcs.synced, pvcs.forbidden, nodes.rows, nodes.synced, nodes.forbidden, hpas.rows, hpas.synced, hpas.forbidden, certs.rows, certs.synced, certs.forbidden, schedules.rows, schedules.synced, schedules.forbidden, hasCerts, hasVelero, apisQ.data],
  );

  const header = <PageHeader help={<PageHelp route="/best-practices" />} level={2} title="Best practices" />;

  if (!cluster) {
    return (
      <div className="page">
        {header}
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }
  if (waiting) {
    return (
      <div className="page">
        {header}
        <PageLoader message="Checking this cluster…" />
      </div>
    );
  }

  const summary = summarize(checks);
  const shown = sortChecks(filterChecks(checks, { severity, status }), sort);
  const list = (items: BestPracticeCheck[]) => (
    <Stack as="ul" gap={2} style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {items.map((k) => (
        <li key={k.id}>
          <CheckCard check={k} />
        </li>
      ))}
    </Stack>
  );
  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/best-practices" />} level={2} title="Best practices" count={`· ${summary.pass} of ${summary.total} pass`} />
      <div className="page-body">
        <Stack gap={4}>
          <Row role="group" aria-label="Summary" align="center" gap={2} wrap>
            <strong>{summary.score}% pass</strong>
            <Badge tone="ok">Pass {summary.pass}</Badge>
            <Badge tone="warn">Fail {summary.fail}</Badge>
            <Badge>Unknown {summary.unknown}</Badge>
            {SEVERITIES.map((sv) => (
              <Badge key={sv} tone={SEVERITY_TONE[sv]} title={`${sv} checks that fail`}>
                {sv} {summary.failedBySeverity[sv]}
              </Badge>
            ))}
          </Row>
          <div className="small muted">Unknown checks, which Kubebay couldn't read, count against the score, never for it.</div>
          <Row align="center" gap={2} wrap>
            <Select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "all")}>
              <option value="all">All severities</option>
              {SEVERITIES.map((sv) => (
                <option key={sv} value={sv}>{sv}</option>
              ))}
            </Select>
            <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value as CheckStatus | "all")}>
              <option value="all">Pass, fail and unknown</option>
              <option value="fail">Fail</option>
              <option value="unknown">Unknown</option>
              <option value="pass">Pass</option>
            </Select>
            <Select aria-label="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
              <option value="group">Group by theme</option>
              <option value="severity">Sort by severity</option>
              <option value="status">Sort by status</option>
            </Select>
          </Row>
          {shown.length === 0 && <EmptyState><p>No checks match these filters.</p></EmptyState>}
          {sort === "group"
            ? GROUP_ORDER.map((g) => {
                const inGroup = shown.filter((k) => k.group === g);
                return inGroup.length === 0 ? null : (
                  <section key={g}>
                    <strong style={{ display: "block", marginBottom: 8 }}>{g}</strong>
                    {list(inGroup)}
                  </section>
                );
              })
            : list(shown)}
        </Stack>
      </div>
    </div>
  );
}
