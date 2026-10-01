import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { EmptyState, PageHeader } from "@kubebay/ui";
import { FluxSummary } from "../components/FluxSummary";
import { PageLoader } from "../components/PageLoader";
import { crdApi } from "../lib/api";
import { useResourceStream } from "../lib/useResourceStream";
import { useCluster } from "../lib/useCluster";
import { detectFlux, summarizeFluxObject } from "../lib/flux";

export default function Flux() {
  const { cluster: effectiveCluster } = useCluster();
  // /flux?name=<name>: a "Managed by" link from a resource table.
  const [sp] = useSearchParams();

  const crds = useQuery({
    queryKey: ["crds", effectiveCluster],
    queryFn: () => crdApi.list(effectiveCluster),
    enabled: !!effectiveCluster,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const detection = useMemo(() => detectFlux(crds.data ?? []), [crds.data]);

  const kustomizations = useResourceStream(detection.kustomizationGvr ? effectiveCluster : undefined, detection.kustomizationGvr ?? "", {
    mode: "full",
    enabled: !!detection.kustomizationGvr,
  });
  const helmReleases = useResourceStream(detection.helmReleaseGvr ? effectiveCluster : undefined, detection.helmReleaseGvr ?? "", {
    mode: "full",
    enabled: !!detection.helmReleaseGvr,
  });
  const events = useResourceStream(effectiveCluster || undefined, "v1/events", { mode: "full", enabled: detection.installed });

  const items = useMemo(() => {
    const k = kustomizations.rows.map((o) => summarizeFluxObject(o, "Kustomization", events.rows));
    const h = helmReleases.rows.map((o) => summarizeFluxObject(o, "HelmRelease", events.rows));
    return [...k, ...h];
  }, [kustomizations.rows, helmReleases.rows, events.rows]);

  if (!effectiveCluster) {
    return (
      <div className="page">
        <PageHeader level={2} title="Flux" />
        <EmptyState><p>Select a cluster first.</p></EmptyState>
      </div>
    );
  }

  if (crds.isLoading) {
    return (
      <div className="page">
        <PageHeader level={2} title="Flux" />
        <PageLoader message="Checking for Flux…" />
      </div>
    );
  }

  if (!detection.installed) {
    return (
      <div className="page">
        <PageHeader level={2} title="Flux" />
        <div className="page-body">
          <EmptyState>
            <p>Flux not detected on this cluster.</p>
            <p className="muted small">
              Neither <code className="mono">kustomizations.kustomize.toolkit.fluxcd.io</code> nor{" "}
              <code className="mono">helmreleases.helm.toolkit.fluxcd.io</code> was found via cluster discovery.
            </p>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader level={2} title="Flux" count={`· ${items.length} object(s)`} />
      <div className="page-body">
        <div className="muted small" style={{ marginBottom: 12 }}>
          Flux's kustomize-controller corrects drift on reconcile rather than reporting it, so this isn't a
          diff view like Argo CD's — it's the Ready condition, what each object currently manages, and whether
          drift was detected (and already fixed) recently.
        </div>
        <FluxSummary items={items} highlight={sp.get("name")} />
      </div>
    </div>
  );
}
