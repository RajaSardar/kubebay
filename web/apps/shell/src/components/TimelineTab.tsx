import { useMemo } from "react";
import { Badge, DataTable, Stack, type BadgeTone } from "@kubebay/ui";
import { useResourceStream } from "../lib/useResourceStream";
import { buildTimeline, type TimelineEntry } from "../lib/resourceTimeline";
import { fmtAge } from "../lib/resources";

const SOURCE_LABEL: Record<TimelineEntry["source"], string> = {
  event: "event",
  rollout: "rollout",
  condition: "condition",
  container: "container",
};

/**
 * Intelligence roadmap Tier 2 #18: a workload's events, rollout revisions,
 * condition changes and container terminations on one timeline.
 */
export function TimelineTab({ cluster, ns, obj }: { cluster: string; ns: string; obj: Record<string, unknown> | null }) {
  const kind = typeof obj?.kind === "string" ? obj.kind : "";
  const events = useResourceStream(cluster, "v1/events", { mode: "full" });
  const replicaSets = useResourceStream(cluster, "apps/v1/replicasets", { mode: "full", ns: [ns], enabled: kind === "Deployment" });
  const pods = useResourceStream(cluster, "v1/pods", { mode: "full", ns: [ns] });

  const entries = useMemo(
    () => (obj ? buildTimeline({ obj, events: events.rows, replicaSets: replicaSets.rows, pods: pods.rows }) : []),
    [obj, events.rows, replicaSets.rows, pods.rows],
  );

  return (
    <Stack gap={2}>
      <div className="muted small">
        Events are kept for about an hour by default, so older history comes from rollout revisions, condition
        changes and containers' last termination.
      </div>
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
            { key: "subject", header: "Object", className: "mono small", render: (e) => e.subject },
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
