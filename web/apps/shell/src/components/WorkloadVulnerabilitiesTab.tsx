import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState } from "@kubebay/ui";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { detectTrivyOperator } from "../lib/trivyOperator";
import { findingsForWorkload, ownerNamesForWorkload } from "../lib/vulnFindings";
import { VulnFindingsSummary } from "./PodVulnerabilitiesTab";
import { InstallTrivyOperator } from "./InstallTrivyOperator";

/**
 * Workload-level rollup (backlog #16 Phase 2): "does anything in this
 * rollout have a Critical CVE", aggregated across every pod behind this
 * Deployment/StatefulSet/DaemonSet. Wired into GenericDrawer.tsx's real
 * genTabs registry -- unlike Pods (PodVulnerabilitiesTab, Phase 1), these
 * kinds already have that machinery, same as #12's PolicyFindingsTab.
 * A Deployment's own pods are owned by its ReplicaSet(s) (Trivy-Operator
 * labels reports by that immediate owner, never "Deployment"), so this
 * streams the namespace's ReplicaSets only when the open resource is a
 * Deployment -- StatefulSet/DaemonSet own their pods directly and skip that
 * extra stream entirely.
 */
export function WorkloadVulnerabilitiesTab({
  cluster,
  ns,
  name,
  kind,
}: {
  cluster: string;
  ns: string;
  name: string;
  kind: string;
}) {
  const crds = useQuery({
    queryKey: ["crds", cluster],
    queryFn: () => crdApi.list(cluster),
    enabled: !!cluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const detection = useMemo(() => detectTrivyOperator(crds.data ?? []), [crds.data]);

  const isDeployment = kind === "Deployment";
  const replicaSets = useResourceStream(isDeployment ? cluster : undefined, "apps/v1/replicasets", {
    ns: [ns],
    mode: "full",
    enabled: isDeployment,
  });

  const { ownerKind, ownerNames } = useMemo(
    () => ownerNamesForWorkload(kind, name, ns, replicaSets.rows),
    [kind, name, ns, replicaSets.rows],
  );

  // Scoped to this namespace + resource kind (never a bare cluster-wide
  // full-mode stream, same discipline Phase 1 established) -- narrowed
  // further to this workload's own owner names client-side, since a
  // Deployment mid-rollout can have more than one live ReplicaSet name at
  // once, which a single-value label selector can't express.
  const labelSelector = `trivy-operator.resource.kind=${ownerKind}`;
  const reports = useResourceStream(detection.vulnerabilityReportGvr ? cluster : undefined, detection.vulnerabilityReportGvr ?? "", {
    ns: [ns],
    labelSelector,
    mode: "full",
    enabled: !!detection.vulnerabilityReportGvr,
  });

  const findings = useMemo(
    () => findingsForWorkload(reports.rows, { ns, ownerKind, ownerNames }),
    [reports.rows, ns, ownerKind, ownerNames],
  );

  // Same detection-gap fix as PodVulnerabilitiesTab: distinguishes "Trivy-
  // Operator not installed" from "installed, nothing in this rollout".
  if (!crds.isLoading && !detection.installed) {
    return (
      <EmptyState style={{ padding: 14 }}>
        <p>Trivy-Operator not detected on this cluster.</p>
        <InstallTrivyOperator cluster={cluster} />
      </EmptyState>
    );
  }

  return <VulnFindingsSummary findings={findings} emptyLabel="this workload" />;
}
