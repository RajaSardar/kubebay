import { useContext, useEffect, useMemo, useState } from "react";
import { QueryClientContext } from "@tanstack/react-query";
import { CollapsibleSection, InlineBanner, Stack } from "@kubebay/ui";
import { crdApi } from "../lib/api";
import { computeBulkBlastRadius, type BlastAction, type BlastStreams } from "../lib/blastRadius";
import { useClusterLooksProduction } from "../lib/useClusterLooksProduction";
import { useResourceStream, type StreamState } from "../lib/useResourceStream";

const MODELLED = new Set(["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "Pod", "Node"]);

/** A stream's rows, or null when it is unreadable or has not synced: the preview says unknown rather than guess. */
function readable(s: StreamState, enabled: boolean): Record<string, unknown>[] | null | undefined {
  if (!enabled) return undefined;
  if (s.forbidden || !s.synced) return null;
  return s.rows;
}

/** The HTTPRoute GVR when the cluster has Gateway API installed (from the CRD list). */
function useHttpRouteGvr(cluster: string, wanted: boolean): string | null | undefined {
  const client = useContext(QueryClientContext);
  const [gvr, setGvr] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!wanted || !client || !cluster) return;
    let live = true;
    client
      .fetchQuery({ queryKey: ["crds", cluster], queryFn: () => crdApi.list(cluster), staleTime: 5 * 60_000 })
      .then((list) => live && setGvr(list.find((e) => e.group === "gateway.networking.k8s.io" && e.resource === "httproutes")?.gvr ?? null))
      .catch(() => live && setGvr(undefined));
    return () => {
      live = false;
    };
  }, [client, cluster, wanted]);
  return gvr;
}

/**
 * "What this affects": a read-only, collapsible blast-radius summary for a
 * confirm dialog (GAP_PLAN I3). It reads only streams the shell already
 * opens, says "unknown" for any it cannot read, and never blocks the action.
 * Pass `obj` for one object, or `objs` for a multi-select (bulk delete): the
 * preview is then one aggregate across the selection. A "scale-down" also
 * takes `toReplicas`, the count being set.
 */
export function BlastRadiusPreview({
  cluster,
  kind,
  obj,
  objs,
  action,
  toReplicas,
}: {
  cluster: string;
  kind: string;
  obj?: Record<string, unknown>;
  objs?: Record<string, unknown>[];
  action: BlastAction;
  toReplicas?: number;
}) {
  const [open, setOpen] = useState(false);
  const { production } = useClusterLooksProduction(cluster);
  const targets = useMemo(() => objs ?? (obj ? [obj] : []), [objs, obj]);
  // Every namespace in the selection; a cluster-scoped target (a Node) reads all.
  const nsKey = useMemo(() => {
    const list = targets.map((o) => {
      const m = (o.metadata ?? {}) as Record<string, unknown>;
      return typeof m.namespace === "string" ? m.namespace : "";
    });
    return list.length === 0 || list.some((n) => !n) ? "" : [...new Set(list)].sort().join(",");
  }, [targets]);
  const ns = useMemo(() => (nsKey ? nsKey.split(",") : undefined), [nsKey]);

  const modelled = MODELLED.has(kind);
  const on = modelled && action !== "cordon";
  const disruptive = on && action !== "restart";
  const workload = kind === "Deployment" || kind === "StatefulSet";
  const wantRs = on && kind === "Deployment" && (action === "delete" || action === "scale-down");
  const wantHpa = workload && (action === "delete" || action === "scale-zero" || action === "scale-down");
  const opts = (enabled: boolean) => ({ ns, mode: "full" as const, enabled });

  const pods = useResourceStream(cluster, "v1/pods", opts(on));
  const rsets = useResourceStream(cluster, "apps/v1/replicasets", opts(wantRs));
  const services = useResourceStream(cluster, "v1/services", opts(disruptive));
  const ingresses = useResourceStream(cluster, "networking.k8s.io/v1/ingresses", opts(disruptive));
  const hpas = useResourceStream(cluster, "autoscaling/v2/horizontalpodautoscalers", opts(wantHpa));
  const pdbs = useResourceStream(cluster, "policy/v1/poddisruptionbudgets", opts(on));
  const routeGvr = useHttpRouteGvr(cluster, disruptive);
  const routes = useResourceStream(cluster, routeGvr ?? "", opts(disruptive && !!routeGvr));

  const streams: BlastStreams = {
    pods: readable(pods, on),
    replicasets: readable(rsets, wantRs),
    services: readable(services, disruptive),
    ingresses: readable(ingresses, disruptive),
    // No Gateway API on the cluster means no HTTPRoutes, not an unknown.
    httproutes: routeGvr ? readable(routes, true) : [],
    hpas: readable(hpas, wantHpa),
    pdbs: readable(pdbs, on),
  };

  const result = useMemo(
    () => computeBulkBlastRadius({ action, kind, objs: targets, streams, production, toReplicas }),
    // The stream row arrays are stable between flushes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [action, kind, targets, production, toReplicas, streams.pods, streams.replicasets, streams.services, streams.ingresses, streams.httproutes, streams.hpas, streams.pdbs],
  );

  if (!modelled) return result.warnings.length ? <InlineBanner tone="warn" flush>{result.warnings[0]}</InlineBanner> : null;

  return (
    <Stack gap={2}>
      {result.warnings.map((w) => (
        <InlineBanner key={w} tone="warn" flush>
          {w}
        </InlineBanner>
      ))}
      <CollapsibleSection title="What this affects" open={open} onToggle={() => setOpen((o) => !o)}>
        <Stack gap={2}>
          {result.notes.map((n) => (
            <span key={n} className="small muted">
              {n}
            </span>
          ))}
          {result.items.map((i) => (
            <div key={i.id} className="small">
              <span>
                {i.count === null ? (
                  <>
                    {i.label}: <strong>unknown</strong> (the data could not be read)
                  </>
                ) : (
                  <>
                    <strong>{i.count}</strong> {i.label}
                    {i.tone === "warn" ? " (check this)" : ""}
                  </>
                )}
              </span>
              {i.examples.length > 0 && (
                <div className="mono muted">
                  {i.examples.join(", ")}
                  {i.more > 0 ? ` +${i.more} more` : ""}
                </div>
              )}
              {i.note && <div className="muted">{i.note}</div>}
            </div>
          ))}
          {result.items.length === 0 && result.notes.length === 0 && <span className="small muted">Nothing else depends on it that the shell can see.</span>}
        </Stack>
      </CollapsibleSection>
      {!open && result.summary && <span className="small muted">{result.summary}</span>}
    </Stack>
  );
}
