import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, DataTable, EmptyState, SegmentedControl, Stack, StatusPill, type StatusTone } from "@kubebay/ui";
import { ResourceLink } from "./ResourceLink";
import { extSlug, slugForKind } from "../lib/resources";
import {
  summarizeEventBus,
  summarizeEventSource,
  summarizeSensor,
  type ArgoEventsDetection,
  type ConditionState,
  type SensorTrigger,
} from "../lib/argoEvents";

type Tab = "eventSources" | "sensors" | "eventBus";
type Obj = Record<string, unknown>;

const TONE: Record<ConditionState["state"], StatusTone> = {
  Ready: "ok",
  "Not ready": "err",
  Unknown: "terminated",
};

function State({ s }: { s: ConditionState }) {
  return (
    <Stack gap={1}>
      <span title={s.conditions.map((c) => `${c.type}: ${c.ok ? "True" : "not True"}`).join("\n") || undefined}>
        <StatusPill tone={TONE[s.state]}>{s.state}</StatusPill>
      </span>
      {s.message && <span className="muted small">{s.message}</span>}
    </Stack>
  );
}

function TriggerTarget({ t, workflowGvr }: { t: SensorTrigger; workflowGvr?: string }) {
  if (!t.targetKind) return null;
  const fixed = t.targetName !== "" && !t.targetName.endsWith("*");
  let target: React.ReactNode = t.targetName || "";
  if (t.isWorkflow) {
    target =
      fixed && workflowGvr ? (
        <ResourceLink kind={`ext--${extSlug(workflowGvr)}`} ns={t.targetNs} name={t.targetName} />
      ) : (
        <Link to="/argo-workflows">{t.targetName || "see Argo Workflows"}</Link>
      );
  } else {
    const slug = slugForKind(t.targetKind);
    if (fixed && slug) target = <ResourceLink kind={slug} ns={t.targetNs} name={t.targetName} />;
  }
  return (
    <>
      {" → "}
      <Badge>{t.targetKind}</Badge> <span className="mono">{target}</span>
    </>
  );
}

/**
 * Argo Events inventory: EventSources (what event types each declares),
 * Sensors (their dependencies and what each trigger creates) and the
 * EventBuses between them. Read-only: status comes from the objects' own
 * conditions.
 */
export function ArgoEventsView({
  gvrs,
  workflowGvr,
  eventSources,
  sensors,
  eventBuses,
}: {
  gvrs: ArgoEventsDetection;
  /** The Workflow GVR when Argo Workflows is installed, to link a trigger to a named Workflow. */
  workflowGvr?: string;
  eventSources: Obj[];
  sensors: Obj[];
  eventBuses: Obj[];
}) {
  const [tab, setTab] = useState<Tab>("eventSources");
  const sources = useMemo(() => eventSources.map(summarizeEventSource), [eventSources]);
  const sensorRows = useMemo(() => sensors.map(summarizeSensor), [sensors]);
  const buses = useMemo(() => eventBuses.map(summarizeEventBus), [eventBuses]);

  const nameCell = (gvr: string | undefined, ns: string, name: string) =>
    gvr ? <ResourceLink kind={`ext--${extSlug(gvr)}`} ns={ns} name={name} /> : name;

  return (
    <Stack gap={3}>
      <SegmentedControl<Tab>
        label="Argo Events kind"
        value={tab}
        onChange={setTab}
        options={[
          { value: "eventSources", label: `EventSources (${eventSources.length})` },
          { value: "sensors", label: `Sensors (${sensors.length})` },
          { value: "eventBus", label: `EventBus (${eventBuses.length})` },
        ]}
      />

      {tab === "eventSources" && (
        <DataTable
          rows={sources}
          rowKey={(r) => `${r.ns}/${r.name}`}
          empty={<EmptyState><p>No EventSources in the selected namespaces.</p></EmptyState>}
          columns={[
            { key: "name", header: "Name", className: "mono td-name", render: (r) => nameCell(gvrs.eventSourceGvr, r.ns, r.name) },
            { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.ns },
            { key: "state", header: "State", render: (r) => <State s={r} /> },
            { key: "bus", header: "EventBus", className: "mono small", render: (r) => r.bus },
            {
              key: "events",
              header: "Events",
              className: "small",
              render: (r) =>
                r.events.length === 0 ? (
                  "–"
                ) : (
                  <Stack gap={1}>
                    {r.events.map((e) => (
                      <span key={`${e.type}/${e.name}`} className="mono">{`${e.type}: ${e.name}`}</span>
                    ))}
                  </Stack>
                ),
            },
          ]}
        />
      )}

      {tab === "sensors" && (
        <DataTable
          rows={sensorRows}
          rowKey={(r) => `${r.ns}/${r.name}`}
          empty={<EmptyState><p>No Sensors in the selected namespaces.</p></EmptyState>}
          columns={[
            { key: "name", header: "Name", className: "mono td-name", render: (r) => nameCell(gvrs.sensorGvr, r.ns, r.name) },
            { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.ns },
            { key: "state", header: "State", render: (r) => <State s={r} /> },
            { key: "bus", header: "EventBus", className: "mono small", render: (r) => r.bus },
            {
              key: "deps",
              header: "Listens to",
              className: "small",
              render: (r) =>
                r.dependencies.length === 0 ? (
                  "–"
                ) : (
                  <Stack gap={1}>
                    {r.dependencies.map((d) => (
                      <span key={d.name} className="mono">{`${d.eventSource} / ${d.event}`}</span>
                    ))}
                  </Stack>
                ),
            },
            {
              key: "triggers",
              header: "Triggers",
              className: "small",
              render: (r) =>
                r.triggers.length === 0 ? (
                  "–"
                ) : (
                  <Stack gap={1}>
                    {r.triggers.map((t, i) => (
                      <span key={`${t.name}/${i}`}>
                        <span className="mono strong">{t.name || "(unnamed)"}</span> <Badge>{t.type || "unknown"}</Badge>
                        {t.operation && <span className="muted"> {t.operation}</span>}
                        <TriggerTarget t={t} workflowGvr={workflowGvr} />
                      </span>
                    ))}
                  </Stack>
                ),
            },
          ]}
        />
      )}

      {tab === "eventBus" && (
        <DataTable
          rows={buses}
          rowKey={(r) => `${r.ns}/${r.name}`}
          empty={<EmptyState><p>No EventBus in the selected namespaces.</p></EmptyState>}
          columns={[
            { key: "name", header: "Name", className: "mono td-name", render: (r) => nameCell(gvrs.eventBusGvr, r.ns, r.name) },
            { key: "ns", header: "Namespace", className: "mono small", render: (r) => r.ns },
            { key: "state", header: "State", render: (r) => <State s={r} /> },
            { key: "backend", header: "Backend", className: "mono small", render: (r) => r.backend },
            { key: "replicas", header: "Replicas", className: "mono small", render: (r) => (r.replicas === null ? "–" : r.replicas) },
          ]}
        />
      )}
    </Stack>
  );
}
