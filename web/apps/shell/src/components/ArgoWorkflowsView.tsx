import { useMemo, useState } from "react";
import { ArmedButton, Button, Card, DataTable, EmptyState, InlineBanner, Row, SegmentedControl, Stack, StatusPill, statusTone } from "@kubebay/ui";
import { api } from "../lib/api";
import { ResourceLink } from "./ResourceLink";
import { extSlug, fmtAge } from "../lib/resources";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import {
  buildNodeTree,
  matchNodePods,
  resubmitManifest,
  summarizeCronWorkflow,
  summarizeTemplate,
  summarizeWorkflow,
  workflowActionRequest,
  workflowActions,
  type ArgoWorkflowsDetection,
  type CronWorkflowSummary,
  type TemplateSummary,
  type WorkflowActionId,
  type WorkflowNodeRow,
  type WorkflowSummary,
} from "../lib/argoWorkflows";

type Tab = "workflows" | "templates" | "clusterTemplates" | "crons";
type Obj = Record<string, unknown>;

function ago(iso: string, now: Date): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "–" : `${fmtAge(Math.max(0, now.getTime() - t))} ago`;
}

const DONE_VERB: Record<WorkflowActionId, string> = {
  stop: "Stop requested",
  terminate: "Terminate requested",
  suspend: "Suspended",
  resume: "Resumed",
  resubmit: "Resubmitted as a new workflow",
};

/**
 * Argo Workflows: the Workflows list with a node tree per workflow, the
 * template kinds, and CronWorkflows. Actions are limited to what is one patch
 * (spec.shutdown, spec.suspend) or a plain create (resubmit); each goes
 * through the same audited apply/create path as the YAML editor.
 */
export function ArgoWorkflowsView({
  cluster,
  gvrs,
  workflows,
  templates,
  clusterTemplates,
  crons,
  pods,
  now = new Date(),
}: {
  cluster: string;
  gvrs: ArgoWorkflowsDetection;
  workflows: Obj[];
  templates: Obj[];
  clusterTemplates: Obj[];
  crons: Obj[];
  pods: Obj[];
  now?: Date;
}) {
  const [tab, setTab] = useState<Tab>("workflows");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { production } = useClusterLooksProduction(cluster);

  const rows = useMemo(
    () =>
      workflows
        .map((w) => ({ obj: w, s: summarizeWorkflow(w, now) }))
        .sort((a, b) => (Date.parse(b.s.startedAt) || Infinity) - (Date.parse(a.s.startedAt) || Infinity)),
    [workflows, now],
  );
  const cronRows = useMemo(() => crons.map((c) => ({ obj: c, s: summarizeCronWorkflow(c, now) })), [crons, now]);
  const templateRows = useMemo(() => templates.map(summarizeTemplate), [templates]);
  const clusterTemplateRows = useMemo(() => clusterTemplates.map(summarizeTemplate), [clusterTemplates]);

  const selectedRow = selected ? rows.find((r) => `${r.s.ns}/${r.s.name}` === selected) : undefined;

  async function run(label: string, fn: () => Promise<unknown>, verb: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await fn();
      setDone(verb);
    } catch (e) {
      setError(`Couldn't ${label}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function runWorkflowAction(wf: Obj, id: WorkflowActionId) {
    const s = summarizeWorkflow(wf, now);
    if (id === "resubmit") {
      return run(`resubmit ${s.name}`, () => api.createResource({ cluster, yaml: resubmitManifest(wf), dryRun: false }), DONE_VERB[id]);
    }
    if (!gvrs.workflowGvr) return;
    return run(
      `${id} ${s.name}`,
      () => api.applyYaml(workflowActionRequest({ cluster, gvr: gvrs.workflowGvr!, ns: s.ns, name: s.name }, id)),
      DONE_VERB[id],
    );
  }

  function runCronToggle(c: CronWorkflowSummary) {
    if (!gvrs.cronGvr) return;
    const id: WorkflowActionId = c.suspended ? "resume" : "suspend";
    return run(
      `${id} ${c.name}`,
      () => api.applyYaml(workflowActionRequest({ cluster, gvr: gvrs.cronGvr!, ns: c.ns, name: c.name, kind: "CronWorkflow" }, id)),
      DONE_VERB[id],
    );
  }

  const tabOptions: { value: Tab; label: string }[] = [
    { value: "workflows", label: `Workflows (${workflows.length})` },
    { value: "templates", label: `WorkflowTemplates (${templates.length})` },
    { value: "clusterTemplates", label: `ClusterWorkflowTemplates (${clusterTemplates.length})` },
    { value: "crons", label: `CronWorkflows (${crons.length})` },
  ];

  return (
    <Stack gap={3}>
      <SegmentedControl<Tab> label="Argo Workflows kind" value={tab} onChange={setTab} options={tabOptions} />

      {error && <InlineBanner flush>{error}</InlineBanner>}
      {done && <InlineBanner flush tone="ok">{done}.</InlineBanner>}

      {tab === "workflows" && (
        <>
          {selected && !selectedRow && <InlineBanner flush tone="warn">Workflow {selected} is no longer in this cluster.</InlineBanner>}
          {selectedRow && (
            <WorkflowDetail
              wf={selectedRow.obj}
              summary={selectedRow.s}
              pods={pods}
              gvr={gvrs.workflowGvr}
              busy={busy}
              production={production}
              onAction={(id) => void runWorkflowAction(selectedRow.obj, id)}
              onClose={() => setSelected(null)}
            />
          )}
          <DataTable
            rows={rows}
            rowKey={(r) => `${r.s.ns}/${r.s.name}`}
            onRowClick={(r) => setSelected(`${r.s.ns}/${r.s.name}`)}
            empty={<EmptyState><p>No workflows in the selected namespaces.</p></EmptyState>}
            columns={[
              { key: "name", header: "Name", className: "mono td-name", render: (r) => r.s.name },
              { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.s.ns },
              { key: "phase", header: "Phase", render: (r) => <StatusPill tone={statusTone(r.s.phase)}>{r.s.phase}</StatusPill> },
              { key: "progress", header: "Progress", className: "mono small", render: (r) => r.s.progressText },
              { key: "duration", header: "Duration", className: "mono small", render: (r) => r.s.durationText },
              { key: "started", header: "Started", className: "small", render: (r) => (r.s.startedAt ? ago(r.s.startedAt, now) : "–") },
            ]}
          />
        </>
      )}

      {tab === "templates" && <TemplateTable rows={templateRows} gvr={gvrs.templateGvr} kind="WorkflowTemplate" />}
      {tab === "clusterTemplates" && <TemplateTable rows={clusterTemplateRows} gvr={gvrs.clusterTemplateGvr} kind="ClusterWorkflowTemplate" />}

      {tab === "crons" && (
        <DataTable
          rows={cronRows}
          rowKey={(r) => `${r.s.ns}/${r.s.name}`}
          empty={<EmptyState><p>No CronWorkflows in the selected namespaces.</p></EmptyState>}
          columns={[
            {
              key: "name",
              header: "Name",
              className: "mono td-name",
              render: (r) =>
                gvrs.cronGvr ? (
                  <ResourceLink kind={`ext--${extSlug(gvrs.cronGvr)}`} ns={r.s.ns} name={r.s.name} />
                ) : (
                  r.s.name
                ),
            },
            { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.s.ns },
            { key: "schedule", header: "Schedule", className: "mono small", render: (r) => r.s.schedule || "–" },
            { key: "tz", header: "Time zone", className: "small", render: (r) => r.s.timezone || "UTC" },
            {
              key: "next",
              header: "Next run",
              className: "small",
              title: (r) => r.s.nextRunTitle,
              render: (r) => r.s.nextRun,
            },
            { key: "last", header: "Last run", className: "small", render: (r) => (r.s.lastScheduled ? ago(r.s.lastScheduled, now) : "–") },
            { key: "active", header: "Active", className: "mono small", render: (r) => r.s.active },
            {
              key: "state",
              header: "State",
              render: (r) => (r.s.suspended ? <StatusPill tone="warn">Suspended</StatusPill> : <StatusPill tone="ok">Active</StatusPill>),
            },
            {
              key: "actions",
              header: "",
              render: (r) =>
                gvrs.cronGvr ? (
                  <ArmedButton
                    label={r.s.suspended ? "Resume" : "Suspend"}
                    busy={busy}
                    variant="primary"
                    onGo={() => void runCronToggle(r.s)}
                  />
                ) : null,
            },
          ]}
        />
      )}
    </Stack>
  );
}

function TemplateTable({ rows, gvr, kind }: { rows: TemplateSummary[]; gvr?: string; kind: string }) {
  return (
    <DataTable
      rows={rows}
      rowKey={(r) => `${r.ns}/${r.name}`}
      empty={<EmptyState><p>No {kind}s found.</p></EmptyState>}
      columns={[
        {
          key: "name",
          header: "Name",
          className: "mono td-name",
          render: (r) => (gvr ? <ResourceLink kind={`ext--${extSlug(gvr)}`} ns={r.ns} name={r.name} /> : r.name),
        },
        { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.ns || "–" },
        { key: "entry", header: "Entrypoint", className: "mono small", render: (r) => r.entrypoint || "–" },
        { key: "count", header: "Templates", className: "mono small", render: (r) => r.templateCount },
        { key: "created", header: "Created", className: "small", render: (r) => r.created || "–" },
      ]}
    />
  );
}

function WorkflowDetail({
  wf,
  summary,
  pods,
  gvr,
  busy,
  production,
  onAction,
  onClose,
}: {
  wf: Obj;
  summary: WorkflowSummary;
  pods: Obj[];
  gvr?: string;
  busy: boolean;
  production: boolean;
  onAction: (id: WorkflowActionId) => void;
  onClose: () => void;
}) {
  const nodes = useMemo(() => buildNodeTree(wf), [wf]);
  const podFor = useMemo(() => matchNodePods(summary.name, nodes, pods), [summary.name, nodes, pods]);
  const actions = workflowActions(wf);

  return (
    <Card>
      <Stack gap={2}>
        <Row align="center" gap={2} wrap>
          <span className="mono strong">{summary.name}</span>
          <span className="muted small">{summary.ns}</span>
          <StatusPill tone={statusTone(summary.phase)}>{summary.phase}</StatusPill>
          {summary.suspended && <StatusPill tone="warn">Suspended</StatusPill>}
          {gvr && (
            <ResourceLink kind={`ext--${extSlug(gvr)}`} ns={summary.ns} name={summary.name}>
              <span className="small">Open YAML</span>
            </ResourceLink>
          )}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </Row>
        {summary.message && <div className="small">{summary.message}</div>}
        {production && (
          <InlineBanner flush tone="warn">
            This cluster looks like production. Check the workflow before you change it.
          </InlineBanner>
        )}
        <Row gap={2} wrap>
          {actions.map((a) => (
            <ArmedButton
              key={a.id}
              label={a.label}
              variant={a.id === "terminate" ? "danger" : "primary"}
              busy={busy || (a.id !== "resubmit" && !gvr)}
              onGo={() => onAction(a.id)}
            />
          ))}
        </Row>
        {nodes.length === 0 ? (
          <div className="muted small">No node status yet. The controller has not started this workflow.</div>
        ) : (
          <DataTable<WorkflowNodeRow>
            rows={nodes}
            rowKey={(n) => n.id}
            wrap={false}
            columns={[
              {
                key: "node",
                header: "Node",
                className: "mono small",
                render: (n) => <span style={{ paddingLeft: n.depth * 16 }}>{n.displayName}</span>,
              },
              { key: "type", header: "Type", className: "small", render: (n) => n.type || "–" },
              { key: "phase", header: "Phase", render: (n) => (n.phase ? <StatusPill tone={statusTone(n.phase)}>{n.phase}</StatusPill> : "–") },
              {
                key: "pod",
                header: "Pod",
                className: "mono small",
                render: (n) => {
                  const pod = podFor.get(n.id);
                  return pod ? <ResourceLink kind="pods" ns={summary.ns} name={pod} /> : "–";
                },
              },
              { key: "message", header: "Message", className: "small", render: (n) => n.message || "" },
            ]}
          />
        )}
      </Stack>
    </Card>
  );
}
