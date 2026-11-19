import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Badge, CellLink, DataTable, SegmentedControl, Stack, type BadgeTone } from "@kubebay/ui";
import { api } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { buildTimeline, filterTimeline, timelineHref, type TimelineEntry, type TimelineGroup } from "../lib/resourceTimeline";
import { fmtAge } from "../lib/resources";

const SOURCE_LABEL: Record<TimelineEntry["source"], string> = {
  event: "event",
  rollout: "rollout",
  condition: "condition",
  container: "container",
  audit: "audit",
};

type View = "all" | TimelineGroup;
const GROUPS: Record<View, ReadonlySet<TimelineGroup>> = {
  all: new Set<TimelineGroup>(["events", "audit", "rollouts"]),
  events: new Set<TimelineGroup>(["events"]),
  audit: new Set<TimelineGroup>(["audit"]),
  rollouts: new Set<TimelineGroup>(["rollouts"]),
};

/**
 * Intelligence roadmap Tier 2 #18: a workload's events, rollout revisions,
 * condition changes, container terminations and the changes made through
 * Kubebay (audit log) on one timeline, filterable by source.
 */
export function TimelineTab({ cluster, ns, obj }: { cluster: string; ns: string; obj: Record<string, unknown> | null }) {
  const kind = typeof obj?.kind === "string" ? obj.kind : "";
  const events = useResourceStream(cluster, "v1/events", { mode: "full" });
  const replicaSets = useResourceStream(cluster, "apps/v1/replicasets", { mode: "full", ns: [ns], enabled: kind === "Deployment" });
  const pods = useResourceStream(cluster, "v1/pods", { mode: "full", ns: [ns] });

  const metaName = (obj?.metadata as { name?: unknown } | undefined)?.name;
  const name = typeof metaName === "string" ? metaName : "";
  const audit = useQuery({
    queryKey: ["audit", cluster, ns, name],
    queryFn: () => api.auditLog({ cluster, namespace: ns, resource: name }),
    enabled: !!name,
    retry: false,
  });
  const [view, setView] = useState<View>("all");
  const navigate = useNavigate();

  const all = useMemo(
    () => (obj ? buildTimeline({ obj, events: events.rows, replicaSets: replicaSets.rows, pods: pods.rows, audit: audit.data }) : []),
    [obj, events.rows, replicaSets.rows, pods.rows, audit.data],
  );
  const entries = useMemo(() => filterTimeline(all, GROUPS[view]), [all, view]);

  return (
    <Stack gap={2}>
      <div className="muted small">
        Events are kept for about an hour by default, so older history comes from rollout revisions, condition
        changes and containers' last termination.
      </div>
      <SegmentedControl<View>
        label="Timeline source"
        value={view}
        onChange={setView}
        options={[
          { value: "all", label: "All" },
          { value: "events", label: "Events" },
          { value: "audit", label: "Audit" },
          { value: "rollouts", label: "Rollouts" },
        ]}
      />
      {entries.length === 0 ? (
        <div className="muted small">Nothing recorded for this {kind.toLowerCase() || "resource"} yet.</div>
      ) : (
        <DataTable
          rows={entries}
          rowKey={(e) => `${e.at}|${e.source}|${e.subject}|${e.title}`}
          columns={[
            {
              key: "at",
              header: "When",
              className: "mono small",
              render: (e) => <span title={e.at}>{fmtAge(Date.now() - (Date.parse(e.at) || 0))}</span>,
            },
            {
              key: "source",
              header: "Source",
              render: (e) => {
                const tone: BadgeTone | undefined = e.severity === "warning" ? "warn" : e.source === "rollout" ? "info" : undefined;
                return <Badge tone={tone}>{SOURCE_LABEL[e.source]}</Badge>;
              },
            },
            {
              key: "subject",
              header: "Object",
              className: "mono small",
              render: (e) => {
                const to = timelineHref(e.subject, ns);
                return to ? (
                  <CellLink
                    href={to}
                    onClick={(ev) => {
                      ev.preventDefault();
                      navigate(to);
                    }}
                  >
                    {e.subject}
                  </CellLink>
                ) : (
                  e.subject
                );
              },
            },
            {
              key: "what",
              header: "What",
              render: (e) => (
                <Stack gap={1}>
                  <span className="small strong">{e.title}</span>
                  {e.detail && <span className="muted small">{e.detail}</span>}
                </Stack>
              ),
            },
          ]}
        />
      )}
    </Stack>
  );
}
