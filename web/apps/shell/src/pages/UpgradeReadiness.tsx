import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { PageLoader } from "../components/PageLoader";
import { UpgradeReadinessPanel } from "../components/UpgradeReadinessPanel";
import { discoveryApi } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { computeUpgradeReadiness } from "../lib/upgradeReadiness";

/**
 * Backlog #25: cluster-wide advisory for API versions this cluster's own
 * server version will deprecate or remove soon. Deliberately scoped to a
 * discovery-table check (does the server still serve this soon-to-be-removed
 * apiVersion) rather than per-object detection, since Kubebay only ever
 * fetches known kinds via their current pinned apiVersion (resources.ts'
 * DEFS) -- it never sees an object's actual last-applied apiVersion without
 * managedFields, which the engine strips today. Mirrors Keda.tsx's
 * single-cluster page shape.
 */
export default function UpgradeReadiness() {
  const { cluster: effectiveCluster, list } = useCluster();
  const serverVersion = useMemo(() => list.find((c) => c.id === effectiveCluster)?.version, [list, effectiveCluster]);

  const apiVersionsQ = useQuery({
    queryKey: ["apiversions", effectiveCluster],
    queryFn: () => discoveryApi.apiVersions(effectiveCluster!),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const findings = useMemo(
    () => (serverVersion ? computeUpgradeReadiness(serverVersion, apiVersionsQ.data ?? []) : []),
    [serverVersion, apiVersionsQ.data],
  );

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader level={2} title="Upgrade Readiness" />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }

  if (apiVersionsQ.isLoading || (!serverVersion && !apiVersionsQ.isError)) {
    return (
      <div className="page">
        <PageHeader level={2} title="Upgrade Readiness" />
        <PageLoader message="Checking served API versions…" />
      </div>
    );
  }

  if (apiVersionsQ.isError || !serverVersion) {
    return (
      <div className="page">
        <PageHeader level={2} title="Upgrade Readiness" />
        <div className="page-body">
          <EmptyState><p>Couldn't determine this cluster's API versions.</p></EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader level={2} title="Upgrade Readiness" count={`· server ${serverVersion}`} />
      <div className="page-body">
        <UpgradeReadinessPanel findings={findings} serverVersion={serverVersion} />
      </div>
    </div>
  );
}
