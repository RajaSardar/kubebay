import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader, TextField } from "@kubebay/ui";
import { PageHelp } from "../components/PageHelp";
import { PageLoader } from "../components/PageLoader";
import { UpgradeReadinessPanel } from "../components/UpgradeReadinessPanel";
import { UpgradeImpactPanel } from "../components/UpgradeImpactPanel";
import { discoveryApi } from "../lib/api";
import { useCluster } from "../lib/useCluster";
import { computeUpgradeReadiness } from "../lib/upgradeReadiness";
import { useResourceStream, type StreamState } from "../lib/useResourceStream";
import { pdbDrainBlockers } from "../lib/upgradePdb";
import { versionSkewFindings } from "../lib/upgradeSkew";
import { webhookFindings } from "../lib/upgradeWebhooks";

const rowsOf = (s: StreamState) => (s.forbidden || !s.synced ? undefined : s.rows);

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

  const c = effectiveCluster || undefined;
  const [target, setTarget] = useState("");
  const pdbs = useResourceStream(c, "policy/v1/poddisruptionbudgets", { mode: "full" });
  const pods = useResourceStream(c, "v1/pods", { mode: "full" });
  const nodes = useResourceStream(c, "v1/nodes", { mode: "full" });
  const validating = useResourceStream(c, "admissionregistration.k8s.io/v1/validatingwebhookconfigurations", { mode: "full" });
  const mutating = useResourceStream(c, "admissionregistration.k8s.io/v1/mutatingwebhookconfigurations", { mode: "full" });
  const endpoints = useResourceStream(c, "v1/endpoints", { mode: "full" });

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

  const pdbRows = rowsOf(pdbs);
  const podRows = rowsOf(pods);
  const nodeRows = rowsOf(nodes);
  const validatingRows = rowsOf(validating);
  const mutatingRows = rowsOf(mutating);
  const endpointRows = rowsOf(endpoints);
  const targetValid = /^v?1\.\d+/.test(target.trim()) ? target.trim() : undefined;
  const pdbImpact = useMemo(() => (pdbRows && podRows ? pdbDrainBlockers(pdbRows, podRows) : undefined), [pdbRows, podRows]);
  const skewImpact = useMemo(
    () => (nodeRows && serverVersion ? versionSkewFindings(serverVersion, nodeRows, targetValid) : undefined),
    [nodeRows, serverVersion, targetValid],
  );
  const webhookImpact = useMemo(
    () => (validatingRows && mutatingRows ? webhookFindings({ validating: validatingRows, mutating: mutatingRows, endpoints: endpointRows }) : undefined),
    [validatingRows, mutatingRows, endpointRows],
  );

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/upgrade-readiness" />} level={2} title="Upgrade Readiness" />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }

  if (apiVersionsQ.isLoading || (!serverVersion && !apiVersionsQ.isError)) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/upgrade-readiness" />} level={2} title="Upgrade Readiness" />
        <PageLoader message="Checking served API versions…" />
      </div>
    );
  }

  if (apiVersionsQ.isError || !serverVersion) {
    return (
      <div className="page">
        <PageHeader help={<PageHelp route="/upgrade-readiness" />} level={2} title="Upgrade Readiness" />
        <div className="page-body">
          <EmptyState><p>Couldn't determine this cluster's API versions.</p></EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader help={<PageHelp route="/upgrade-readiness" />} level={2} title="Upgrade Readiness" count={`· server ${serverVersion}`} />
      <div className="page-body">
        <UpgradeReadinessPanel findings={findings} serverVersion={serverVersion} />
        <h2 style={{ marginTop: 24 }}>Upgrade impact</h2>
        <p className="small muted">
          Target version (optional), to check node versions against the release you plan to move to:{" "}
          <TextField aria-label="Target Kubernetes version" placeholder="v1.33.0" value={target} onChange={(e) => setTarget(e.target.value)} />
        </p>
        <UpgradeImpactPanel pdbs={pdbImpact} skew={skewImpact} webhooks={webhookImpact} />
      </div>
    </div>
  );
}
