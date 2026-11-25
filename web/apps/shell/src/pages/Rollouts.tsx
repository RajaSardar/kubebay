import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { NamespaceFilter } from "../components/NamespaceFilter";
import { ForbiddenState, NamespacesDeniedBanner } from "../components/ForbiddenState";
import { RolloutArgoHint } from "../components/RolloutArgoHint";
import { RolloutsDashboard } from "../components/RolloutsDashboard";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { useSelectedNamespaces } from "../lib/namespace-store";
import { detectRollouts } from "../lib/rollouts";

/** Argo Rollouts dashboard: every Rollout with its progress, revisions and AnalysisRuns. Shown only where the Rollout CRD exists. */
export default function Rollouts() {
  const { cluster } = useCluster();
  // The same namespace filter as every list: a Rollout outside it is not "missing".
  const nsFilter = useSelectedNamespaces(cluster || undefined);
  const ns = nsFilter.length > 0 ? nsFilter : undefined;

  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const detection = useMemo(() => detectRollouts(crds.data ?? []), [crds.data]);

  const rollouts = useResourceStream(detection.rolloutGvr ? cluster : undefined, detection.rolloutGvr ?? "", {
    mode: "full",
    ns,
    enabled: !!detection.rolloutGvr,
  });
  const replicaSets = useResourceStream(cluster || undefined, "apps/v1/replicasets", { mode: "full", ns, enabled: !!detection.rolloutGvr });
  const analysisRuns = useResourceStream(detection.analysisRunGvr ? cluster : undefined, detection.analysisRunGvr ?? "", {
    mode: "full",
    ns,
    enabled: !!detection.analysisRunGvr,
  });
  // Services only name the active/preview or stable/canary Services; a user who cannot list them still gets the view, with names only.
  const services = useResourceStream(cluster || undefined, "v1/services", { mode: "full", ns, enabled: !!detection.rolloutGvr });

  // A count before the first sync is a partial one, so it waits for the list.
  const header = (
    <PageHeader
      help={<PageHelp route="/rollouts" />}
      level={2}
      title="Rollouts"
      count={detection.installed && rollouts.synced ? `· ${rollouts.rows.length}` : undefined}
      actions={detection.installed ? <NamespaceFilter cluster={cluster} /> : undefined}
    />
  );

  if (!cluster) {
    return (
      <div className="page">
        {header}
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }
  if (crds.isLoading) {
    return (
      <div className="page">
        {header}
        <PageLoader message="Checking for Argo Rollouts…" />
      </div>
    );
  }
  if (!detection.installed) {
    return (
      <div className="page">
        {header}
        <div className="page-body">
          <EmptyState>
            <p>Argo Rollouts not detected on this cluster.</p>
            <p className="muted small">
              This page lists an existing Argo Rollouts install: the Rollout CRD (<code className="mono">rollouts.argoproj.io</code>) wasn't
              found via cluster discovery. Kubebay doesn't install it.
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  if (rollouts.forbidden && rollouts.rows.length === 0) {
    return (
      <div className="page">
        {header}
        <div className="page-body">
          <ForbiddenState denied={[{ what: "Rollouts", reason: rollouts.forbidden }]} />
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      <div className="page-body">
        {rollouts.denied && rollouts.denied.length > 0 && <NamespacesDeniedBanner noun="Rollouts" namespaces={ns} denied={rollouts.denied} flush />}
        <RolloutArgoHint />
        <RolloutsDashboard
          cluster={cluster}
          rolloutGvr={detection.rolloutGvr}
          rollouts={rollouts.rows}
          replicaSets={replicaSets.rows}
          analysisRuns={analysisRuns.rows}
          services={services.forbidden ? null : services.rows}
        />
      </div>
    </div>
  );
}
