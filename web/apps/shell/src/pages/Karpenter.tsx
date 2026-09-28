import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@kubebay/ui";
import { NodePoolSummary } from "../components/NodePoolSummary";
import { UnschedulablePods } from "../components/UnschedulablePods";
import { PageLoader } from "../components/PageLoader";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { detectKarpenter, buildNodePoolRows, buildUnschedulablePods } from "../lib/karpenter";

export default function Karpenter() {
  const { cluster: effectiveCluster } = useCluster();

  const crds = useQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const detection = useMemo(() => detectKarpenter(crds.data ?? []), [crds.data]);

  const nodePools = useResourceStream(detection.nodePoolGvr ? effectiveCluster : undefined, detection.nodePoolGvr ?? "", {
    mode: "full",
    enabled: !!detection.nodePoolGvr,
  });
  const nodes = useResourceStream(effectiveCluster || undefined, "v1/nodes", { mode: "full", enabled: !!detection.nodePoolGvr });
  const pods = useResourceStream(effectiveCluster || undefined, "v1/pods", { mode: "full", enabled: !!detection.nodePoolGvr });
  const events = useResourceStream(effectiveCluster || undefined, "v1/events", { mode: "full", enabled: !!detection.nodePoolGvr });
  const pdbs = useResourceStream(effectiveCluster || undefined, "policy/v1/poddisruptionbudgets", {
    mode: "full",
    enabled: !!detection.nodePoolGvr,
  });

  const nodePoolRows = useMemo(
    () => buildNodePoolRows(nodePools.rows, nodes.rows, pods.rows),
    [nodePools.rows, nodes.rows, pods.rows],
  );
  const unschedulable = useMemo(() => buildUnschedulablePods(events.rows), [events.rows]);

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader level={2} title="Karpenter" />
        <div className="empty-state"><p>Select a cluster first.</p></div>
      </div>
    );
  }

  if (crds.isLoading) {
    return (
      <div className="page">
        <PageHeader level={2} title="Karpenter" />
        <PageLoader message="Checking for Karpenter…" />
      </div>
    );
  }

  if (!detection.installed) {
    return (
      <div className="page">
        <PageHeader level={2} title="Karpenter" />
        <div className="page-body">
          <div className="empty-state">
            <p>Karpenter not detected on this cluster.</p>
            <p className="muted small">
              This page is read-only observability for an existing Karpenter install — NodePool CRDs
              (<code className="mono">nodepools.karpenter.sh</code>) weren't found via cluster discovery. Kubebay
              deliberately doesn't install or configure Karpenter (it needs cloud IAM/networking Kubebay has no way
              to provision safely) — see the docs for the Helm chart.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader level={2} title="Karpenter" count={`· ${nodePoolRows.length} NodePools`} />
      <div className="page-body">
        <NodePoolSummary
          rows={nodePoolRows}
          cluster={effectiveCluster}
          gvr={detection.nodePoolGvr ?? ""}
          nodes={nodes.rows}
          pods={pods.rows}
          pdbs={pdbs.rows}
        />
        <div style={{ marginTop: 16 }}>
          <UnschedulablePods rows={unschedulable} />
        </div>
      </div>
    </div>
  );
}
