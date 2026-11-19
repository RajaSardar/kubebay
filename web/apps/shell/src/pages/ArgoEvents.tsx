import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { ArgoEventsView } from "../components/ArgoEventsView";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { detectArgoEvents } from "../lib/argoEvents";
import { detectArgoWorkflows } from "../lib/argoWorkflows";

const TITLE = "Argo Events";

export default function ArgoEvents() {
  const { cluster } = useCluster();
  const selectedNs = useSelectedNamespaces(cluster || undefined);
  const ns = selectedNs.length > 0 ? selectedNs : undefined;

  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const detection = useMemo(() => detectArgoEvents(crds.data ?? []), [crds.data]);
  const workflowGvr = useMemo(() => detectArgoWorkflows(crds.data ?? []).workflowGvr, [crds.data]);

  const eventSources = useResourceStream(detection.eventSourceGvr ? cluster : undefined, detection.eventSourceGvr ?? "", {
    mode: "full",
    enabled: !!detection.eventSourceGvr,
    ns,
  });
  const sensors = useResourceStream(detection.sensorGvr ? cluster : undefined, detection.sensorGvr ?? "", {
    mode: "full",
    enabled: !!detection.sensorGvr,
    ns,
  });
  const eventBuses = useResourceStream(detection.eventBusGvr ? cluster : undefined, detection.eventBusGvr ?? "", {
    mode: "full",
    enabled: !!detection.eventBusGvr,
    ns,
  });

  if (!cluster) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/argo-events" />} level={2} title={TITLE} />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }
  if (crds.isLoading) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/argo-events" />} level={2} title={TITLE} />
        <PageLoader message="Checking for Argo Events…" />
      </div>
    );
  }
  if (!detection.installed) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/argo-events" />} level={2} title={TITLE} />
        <div className="page-body">
          <EmptyState>
            <p>Argo Events not detected on this cluster.</p>
            <p className="muted small">
              None of <code className="mono">eventsources</code>, <code className="mono">sensors</code> or{" "}
              <code className="mono">eventbus</code> (group <code className="mono">argoproj.io</code>) was found via cluster discovery.
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        help={<PageHelp route="/argo-events" />}
        level={2}
        title={TITLE}
        count={`· ${eventSources.rows.length} EventSource(s) · ${sensors.rows.length} Sensor(s)`}
      />
      <div className="page-body">
        <ArgoEventsView
          gvrs={detection}
          workflowGvr={workflowGvr}
          eventSources={eventSources.rows}
          sensors={sensors.rows}
          eventBuses={eventBuses.rows}
        />
      </div>
    </div>
  );
}
