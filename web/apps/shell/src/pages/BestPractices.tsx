import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card, CollapsibleSection, EmptyState,PageHeader, Row, Select, Stack, TextField, type BadgeTone } from "@kubebay/ui";
import { BestPracticesExport } from "../components/BestPracticesExport";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { discoveryApi } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { useResourceStream, type StreamState } from "../lib/useResourceStream";
import {
  SEVERITIES,
  computeBestPractices,
  filterChecks,
  frameworkScores,
  sortChecks,
  summarize,
  workloadCoverage,
  type BestPracticeCheck,
  type CheckGroup,
  type CheckStatus,
  type Severity,
  type SortKey,
} from "../lib/bestPractices";
import { applyExceptions, loadExceptions, saveExceptions, type BpException } from "../lib/bestPracticesExceptions";
import { fixFor, type BpFix } from "../lib/bestPracticesFixes";
import { useTerminalDock } from "../lib/terminalDock";

const GROUP_ORDER: CheckGroup[] = ["Reliability", "Security", "Disaster recovery", "Platform"];
const STATUS_TONE: Record<CheckStatus, BadgeTone | undefined> = { pass: "ok", fail: "warn", unknown: undefined, ignored: undefined };
const SEVERITY_TONE: Record<Severity, BadgeTone | undefined> = { Critical: "err", High: "warn", Medium: "info", Low: undefined };
const STATUS_LABEL: Record<CheckStatus, string> = { pass: "Pass", fail: "Fail", unknown: "Unknown", ignored: "Ignored" };

/** The stream's rows once it has them; undefined while it can't give any (RBAC forbids it, or it hasn't synced). */
function rowsOf(s: StreamState): Record<string, unknown>[] | undefined {
  if (s.forbidden) return undefined;
  return s.synced ? s.rows : undefined;
}

interface CardActions {
  ignore: (checkId: string, namespace: string | undefined, reason: string) => void;
  undo: (checkId: string, namespace: string | undefined) => void;
}

/** The inline form that asks why a check (or one namespace of it) is being ignored. */
function IgnoreForm({ label, onSave, onCancel }: { label: string; onSave: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  return (
    <Stack gap={1}>
      <div className="small">{label}</div>
      <Row gap={2} align="center" wrap>
        <TextField aria-label="Reason" placeholder="Why is this fine here?" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button
          onClick={() => {
            if (!reason.trim()) setMissing(true);
            else onSave(reason.trim());
          }}
        >
          Save exception
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </Row>
      {missing && <div className="small muted">A reason is required, so the exception can be reviewed later.</div>}
    </Stack>
  );
}

/** Opens the generated YAML in a "New resource" dock tab; the user reviews, dry-runs and applies it there. */
function openFix(fix: BpFix) {
  useTerminalDock.getState().openNewTab({ kind: fix.kind, yaml: fix.yaml });
}

function CheckCard({ check, actions, fix }: { check: BestPracticeCheck; actions: CardActions; fix?: BpFix }) {
  const [form, setForm] = useState<{ namespace?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [learnOpen, setLearnOpen] = useState(false);
  return (
    <Card>
      <Stack gap={1}>
        <Row align="center" gap={2} wrap>
          <Badge tone={STATUS_TONE[check.status]}>{STATUS_LABEL[check.status]}</Badge>
          <Badge tone={SEVERITY_TONE[check.severity]}>{check.severity}</Badge>
          <strong>{check.title}</strong>
          {check.reference && (
            <Badge title={`${check.reference} of the CIS Kubernetes Benchmark: a reference, not a compliance result`}>{check.reference}</Badge>
          )}
        </Row>
        <div className="small">{check.detail}</div>
        {check.offenders && check.offenders.length > 0 && (
          <div className="small mono muted">e.g. {check.offenders.join(", ")}</div>
        )}
        <div className="small muted">Why it matters: {check.why}</div>
        {check.exceptions?.map((e) => (
          <Row key={e.namespace ?? "*"} gap={2} align="center" wrap>
            <span className="small">
              {e.namespace ? `Ignored for namespace ${e.namespace}` : "Ignored"}: {e.reason}
            </span>
            <Button variant="ghost" size="sm" onClick={() => actions.undo(check.id, e.namespace)}>
              {e.namespace ? `Undo ignore for ${e.namespace}` : "Undo ignore"}
            </Button>
          </Row>
        ))}
        {fix && (
          <Row gap={2} align="center" wrap>
            <Button size="sm" onClick={() => openFix(fix)}>
              Fix
            </Button>
            <span className="small muted">
              Opens {fix.count === 1 ? "the generated YAML" : `YAML for ${fix.count} objects`} in a New resource tab to review. Nothing is applied until you press Apply.
            </span>
          </Row>
        )}
        {(check.status === "fail" || check.status === "unknown") && !form && (
          <Row gap={2} wrap>
            <Button variant="ghost" size="sm" onClick={() => setForm({})}>
              Ignore this check
            </Button>
            {check.status === "fail" &&
              check.namespaces?.map((n) => (
                <Button key={n} variant="ghost" size="sm" onClick={() => setForm({ namespace: n })}>
                  {`Ignore for namespace ${n}`}
                </Button>
              ))}
          </Row>
        )}
        {form && (
          <IgnoreForm
            label={form.namespace ? `Ignore this check for namespace ${form.namespace}` : "Ignore this check for the whole cluster"}
            onSave={(reason) => {
              actions.ignore(check.id, form.namespace, reason);
              setForm(null);
            }}
            onCancel={() => setForm(null)}
          />
        )}
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
  const daemonsets = useResourceStream(c, "apps/v1/daemonsets", { mode: "full" });
  const cronjobs = useResourceStream(c, "batch/v1/cronjobs", { mode: "full" });
  const pods = useResourceStream(c, "v1/pods", { mode: "full" });
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

  const streams = [deployments, statefulsets, pdbs, netpols, namespaces, ingressClasses, services, pvcs, nodes, hpas, daemonsets, cronjobs, pods];
  const waiting = streams.some((s) => !s.forbidden && !s.synced) || apisQ.isLoading;

  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [status, setStatus] = useState<CheckStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("group");

  const [exceptions, setExceptions] = useState<BpException[]>(() => loadExceptions(cluster ?? ""));
  useEffect(() => setExceptions(loadExceptions(cluster ?? "")), [cluster]);
  const update = (next: BpException[]) => {
    setExceptions(next);
    saveExceptions(cluster ?? "", next);
  };
  const actions: CardActions = {
    ignore: (checkId, namespace, reason) =>
      update([...exceptions.filter((e) => !(e.checkId === checkId && e.namespace === namespace)), { checkId, namespace, reason, createdAt: Date.now() }]),
    undo: (checkId, namespace) => update(exceptions.filter((e) => !(e.checkId === checkId && e.namespace === namespace))),
  };

  const input = useMemo(
    () =>
      ({
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
        daemonsets: rowsOf(daemonsets),
        cronjobs: rowsOf(cronjobs),
        pods: rowsOf(pods),
        certificates: apiGroups ? (hasCerts ? rowsOf(certs) : []) : undefined,
        veleroSchedules: apiGroups ? (hasVelero ? rowsOf(schedules) : []) : undefined,
      }),
    // The streams' state objects change on every flush; their rows are what the checks read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deployments.rows, deployments.synced, deployments.forbidden, statefulsets.rows, statefulsets.synced, statefulsets.forbidden, pdbs.rows, pdbs.synced, pdbs.forbidden, netpols.rows, netpols.synced, netpols.forbidden, namespaces.rows, namespaces.synced, namespaces.forbidden, ingressClasses.rows, ingressClasses.synced, ingressClasses.forbidden, services.rows, services.synced, services.forbidden, pvcs.rows, pvcs.synced, pvcs.forbidden, nodes.rows, nodes.synced, nodes.forbidden, hpas.rows, hpas.synced, hpas.forbidden, certs.rows, certs.synced, certs.forbidden, schedules.rows, schedules.synced, schedules.forbidden, daemonsets.rows, daemonsets.synced, daemonsets.forbidden, cronjobs.rows, cronjobs.synced, cronjobs.forbidden, pods.rows, pods.synced, pods.forbidden, hasCerts, hasVelero, apisQ.data],
  );
  const checks = useMemo(() => applyExceptions(computeBestPractices(input), exceptions), [input, exceptions]);
  const coverage = useMemo(() => workloadCoverage(input), [input]);
  const fixes = useMemo(() => new Map(checks.map((k) => [k.id, fixFor(k, input)])), [checks, input]);

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
          <CheckCard check={k} actions={actions} fix={fixes.get(k.id)} />
        </li>
      ))}
    </Stack>
  );
  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/best-practices" />} level={2} title="Best practices"
        count={`· ${summary.pass} of ${summary.total - summary.ignored} pass`}
        actions={<BestPracticesExport cluster={cluster} checks={checks} coverage={coverage} />}
      />
      <div className="page-body">
        <Stack gap={4}>
          <Row role="group" aria-label="Summary" align="center" gap={2} wrap>
            <strong>{summary.score}% pass</strong>
            <Badge tone="ok">Pass {summary.pass}</Badge>
            <Badge tone="warn">Fail {summary.fail}</Badge>
            <Badge>Unknown {summary.unknown}</Badge>
            {summary.ignored > 0 && <Badge title="Left out of the score">Ignored {summary.ignored}</Badge>}
            {SEVERITIES.map((sv) => (
              <Badge key={sv} tone={SEVERITY_TONE[sv]} title={`${sv} checks that fail`}>
                {sv} {summary.failedBySeverity[sv]}
              </Badge>
            ))}
          </Row>
          <Row role="group" aria-label="Framework scores" align="center" gap={2} wrap>
            <span className="small muted">By framework:</span>
            {frameworkScores(checks).map((f) => (
              <Badge
                key={f.framework}
                title={
                  f.framework === "CIS-referenced"
                    ? `The ${f.total} checks Kubebay tags with a CIS Kubernetes Benchmark reference; not a CIS compliance score`
                    : `${f.framework} checks that pass, of those not ignored`
                }
              >
                {f.framework} {f.score === null ? "all ignored" : `${f.score}% (${f.pass} of ${f.scored})`}
              </Badge>
            ))}
          </Row>
          <div className="small muted">Unknown checks, which Kubebay couldn't read, count against the score, never for it.</div>
          {summary.ignored > 0 && (
            <div className="small muted">
              {summary.ignored} ignored {summary.ignored === 1 ? "check is" : "checks are"} left out of the score; they are never counted as a pass.
            </div>
          )}
          <div role="group" aria-label="Coverage" className="small muted">
            Workload checks cover: {coverage.map((k) => `${k.kind} ${k.read ? k.count : "not read"}`).join(", ")}. System namespaces and pods owned by a controller are left
            out.
          </div>
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
              <option value="ignored">Ignored</option>
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
