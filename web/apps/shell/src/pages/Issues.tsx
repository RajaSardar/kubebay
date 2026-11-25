import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Badge, Button, DataTable, EmptyState, InlineBanner, PageHeader, Row, Select, Stack, NsPill, type BadgeTone } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { InvestigateButton } from "../components/InvestigatePanel";
import { requestFromIssue } from "../lib/aiInvestigate";
import { useCluster } from "../lib/useCluster";
import { useIssues } from "../lib/useIssues";
import { fmtAge } from "../lib/resources";
import {
  DETECTOR_LABEL,
  ISSUE_SEVERITIES,
  filterIssues,
  issueTarget,
  type Issue,
  type IssueSeverity,
  type NotCheckedReason,
} from "../lib/issues";

const TONE: Record<IssueSeverity, BadgeTone | undefined> = { critical: "err", high: "warn", medium: "info", low: undefined };

const REASON: Record<NotCheckedReason, string> = {
  loading: "still loading",
  forbidden: "your access doesn't allow reading it",
  "not-served": "this cluster doesn't have it",
  error: "the check failed",
};

/**
 * Backlog 76: one ranked list of what is wrong in the cluster, from the
 * detectors the other pages already run. Investigate opens the object's drawer
 * or the page that holds the evidence.
 */
export default function Issues() {
  const { cluster } = useCluster();
  const navigate = useNavigate();
  const { issues, notChecked, counts, loading } = useIssues(cluster || undefined);
  // A desktop notification opens /issues?issue=<id>: that one issue, with a way back to all.
  const [params, setParams] = useSearchParams();
  const only = params.get("issue");
  const [severity, setSeverity] = useState<IssueSeverity | "all">("all");
  const [kind, setKind] = useState("all");
  const [namespace, setNamespace] = useState("all");

  const kinds = useMemo(() => [...new Set(issues.map((i) => i.kind))].sort(), [issues]);
  const namespaces = useMemo(() => [...new Set(issues.map((i) => i.namespace).filter(Boolean))].sort(), [issues]);
  const shown = useMemo(
    () =>
      filterIssues(issues, {
        severity: severity === "all" ? [] : [severity],
        kind: kind === "all" ? [] : [kind],
        namespace: namespace === "all" ? [] : [namespace],
      }).filter((i) => !only || i.id === only),
    [issues, severity, kind, namespace, only],
  );

  const header = <PageHeader help={<PageHelp route="/issues" />} level={2} title="Issues" count={issues.length > 0 ? `· ${issues.length}` : undefined} />;

  if (!cluster) {
    return (
      <div className="page">
        {header}
        <EmptyState title="Connect a cluster to see its issues." />
      </div>
    );
  }

  const pending = notChecked.filter((n) => n.reason === "loading");
  const unavailable = notChecked.filter((n) => n.reason !== "loading");
  const now = Date.now();

  return (
    <div className="page">
      {header}
      <Stack gap={2}>
        <Row align="center" gap={2} wrap>
          {ISSUE_SEVERITIES.map((s) => (
            <Badge key={s} tone={TONE[s]}>{`${counts[s]} ${s}`}</Badge>
          ))}
          <Select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity | "all")}>
            <option value="all">All severities</option>
            {ISSUE_SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
          <Select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">All kinds</option>
            {kinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </Select>
          <Select aria-label="Namespace" value={namespace} onChange={(e) => setNamespace(e.target.value)}>
            <option value="all">All namespaces</option>
            {namespaces.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </Select>
        </Row>
        {only && (
          <InlineBanner>
            Showing the one issue a notification pointed at.{" "}
            <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>
              Show all issues
            </Button>
          </InlineBanner>
        )}
        {loading && pending.length > 0 && (
          <div className="small muted" role="status">
            Still checking {pending.length} {pending.length === 1 ? "source" : "sources"}. What is listed so far may not be everything.
          </div>
        )}
        {unavailable.length > 0 && (
          <InlineBanner tone="warn">
            Not checked: {unavailable.map((n) => `${DETECTOR_LABEL[n.detector]} (${REASON[n.reason]})`).join("; ")}.
          </InlineBanner>
        )}
      </Stack>
      <DataTable<Issue>
        rows={shown}
        rowKey={(i) => i.id}
        loading={loading && issues.length === 0}
        loadingLabel="Checking the cluster for issues…"
        empty={
          issues.length > 0 ? (
            <EmptyState title={only ? "That issue is no longer raised." : "No issue matches these filters."} />
          ) : notChecked.length === 0 ? (
            <EmptyState title="No issues found." hint="Every check ran and found nothing wrong." />
          ) : (
            <EmptyState title="Nothing found in what could be read." hint="Some checks could not run, so this is not an all clear." />
          )
        }
        columns={[
          { key: "severity", header: "Severity", width: 96, render: (i) => <Badge tone={TONE[i.severity]}>{i.severity}</Badge> },
          {
            key: "object",
            header: "Object",
            className: "mono td-name",
            title: (i) => `${i.kind} ${i.name}`,
            render: (i) => (
              <>
                <span className="cell-secondary">{i.kind} </span>
                {i.name}
              </>
            ),
          },
          { key: "namespace", header: "Namespace", width: 140, render: (i) => (i.namespace ? <NsPill>{i.namespace}</NsPill> : <span className="cell-secondary">cluster</span>) },
          { key: "summary", header: "What is wrong", className: "cell-secondary", title: (i) => i.summary, render: (i) => i.summary },
          { key: "age", header: "Age", width: 64, className: "cell-secondary", render: (i) => (i.since === undefined ? "-" : fmtAge(Math.max(0, now - i.since))) },
          { key: "by", header: "Raised by", width: 170, className: "cell-secondary", render: (i) => DETECTOR_LABEL[i.detector] },
          {
            key: "investigate",
            header: "",
            width: 270,
            render: (i) => (
              <Row gap={1}>
                <Button size="sm" aria-label={`Investigate ${i.kind} ${i.name}`} onClick={() => navigate(issueTarget(i))}>
                  Investigate
                </Button>
                <InvestigateButton size="sm" request={requestFromIssue(i)} onOpenObject={() => navigate(issueTarget(i))} />
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}
