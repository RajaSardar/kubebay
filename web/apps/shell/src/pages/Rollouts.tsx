import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { RolloutsDashboard } from "../components/RolloutsDashboard";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { detectRollouts } from "../lib/rollouts";

/** Argo Rollouts dashboard: every Rollout with its progress, revisions and AnalysisRuns. Shown only where the Rollout CRD exists. */
export default function Rollouts() {
  const { cluster } = useCluster();

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
    enabled: !!detection.rolloutGvr,
  });
  const replicaSets = useResourceStream(cluster || undefined, "apps/v1/replicasets", { mode: "full", enabled: !!detection.rolloutGvr });
  const analysisRuns = useResourceStream(detection.analysisRunGvr ? cluster : undefined, detection.analysisRunGvr ?? "", {
    mode: "full",
    enabled: !!detection.analysisRunGvr,
  });

  const header = <PageHeader help={<PageHelp route="/rollouts" />} level={2} title="Rollouts" count={detection.installed ? `· ${rollouts.rows.length}` : undefined} />;

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

  return (
    <div className="page">
      {header}
      <div className="page-body">
        <RolloutsDashboard
          cluster={cluster}
          rolloutGvr={detection.rolloutGvr}
          rollouts={rollouts.rows}
          replicaSets={replicaSets.rows}
          analysisRuns={analysisRuns.rows}
        />
      </div>
    </div>
  );
}
