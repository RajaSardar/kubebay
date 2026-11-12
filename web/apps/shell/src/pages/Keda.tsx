import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { KedaBrowser } from "../components/KedaBrowser";
import { PageLoader } from "../components/PageLoader";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { detectKeda, findOrphanedTriggerAuths } from "../lib/keda";

/**
 * Cluster-wide KEDA page (KEDA-nav-placement research): the per-workload
 * Autoscaling tab (AutoscalingTab.tsx) stays exactly as it is -- this adds
 * the fleet-wide inventory view that tab structurally cannot show, mirroring
 * Karpenter.tsx's own pattern (CRD-detect, stream cluster-wide, render a
 * list). ScaledJobs are deliberately out of scope for this pass: their spec
 * scales a Job template directly (no scaleTargetRef), a different enough
 * shape that explainScaledObject/hpaConflictsWithScaledObject don't apply to
 * them -- the rich inventory is ScaledObjects only; ScaledJobs and the auth
 * kinds appear in KedaBrowser's flat All / per-kind views.
 */
export default function Keda() {
  const { cluster: effectiveCluster } = useCluster();

  const crds = useQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const detection = useMemo(() => detectKeda(crds.data ?? []), [crds.data]);

  const scaledObjects = useResourceStream(detection.scaledObjectGvr ? effectiveCluster : undefined, detection.scaledObjectGvr ?? "", {
    mode: "full",
    enabled: !!detection.scaledObjectGvr,
  });
  const scaledJobs = useResourceStream(detection.scaledJobGvr ? effectiveCluster : undefined, detection.scaledJobGvr ?? "", {
    mode: "full",
    enabled: !!detection.scaledJobGvr,
  });
  const hpas = useResourceStream(effectiveCluster || undefined, "autoscaling/v2/horizontalpodautoscalers", {
    mode: "full",
    enabled: !!detection.scaledObjectGvr,
  });
  const triggerAuths = useResourceStream(detection.triggerAuthGvr ? effectiveCluster : undefined, detection.triggerAuthGvr ?? "", {
    mode: "full",
    enabled: !!detection.triggerAuthGvr,
  });
  const clusterTriggerAuths = useResourceStream(
    detection.clusterTriggerAuthGvr ? effectiveCluster : undefined,
    detection.clusterTriggerAuthGvr ?? "",
    { mode: "full", enabled: !!detection.clusterTriggerAuthGvr },
  );

  const orphanedTriggerAuths = useMemo(
    () => findOrphanedTriggerAuths(scaledObjects.rows, triggerAuths.rows, clusterTriggerAuths.rows),
    [scaledObjects.rows, triggerAuths.rows, clusterTriggerAuths.rows],
  );

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/keda" />} level={2} title="KEDA" />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }

  if (crds.isLoading) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/keda" />} level={2} title="KEDA" />
        <PageLoader message="Checking for KEDA…" />
      </div>
    );
  }

  if (!detection.installed) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/keda" />} level={2} title="KEDA" />
        <div className="page-body">
          <EmptyState>
            <p>KEDA not detected on this cluster.</p>
            <p className="muted small">
              This page is a cluster-wide inventory of an existing KEDA install — ScaledObject CRDs
              (<code className="mono">scaledobjects.keda.sh</code>) weren't found via cluster discovery. Kubebay
              deliberately doesn't install KEDA — per-workload autoscaling (creating a ScaledObject, explaining an
              existing one) is still available from any Deployment/StatefulSet's own Autoscaling tab.
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/keda" />} level={2} title="KEDA" count={`· ${scaledObjects.rows.length} ScaledObjects`} />
      <div className="page-body">
        <KedaBrowser
          scaledObjects={scaledObjects.rows}
          scaledJobs={scaledJobs.rows}
          triggerAuths={triggerAuths.rows}
          clusterTriggerAuths={clusterTriggerAuths.rows}
          hpas={hpas.rows}
          orphanedTriggerAuths={orphanedTriggerAuths}
          scaledObjectGvr={detection.scaledObjectGvr}
          scaledJobGvr={detection.scaledJobGvr}
          triggerAuthGvr={detection.triggerAuthGvr}
          clusterTriggerAuthGvr={detection.clusterTriggerAuthGvr}
        />
      </div>
    </div>
  );
}
