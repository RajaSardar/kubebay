import { matchesSelector, type LabelSelector } from "./labelSelector";

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function str(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export type ServiceMismatchReason = "no-matching-pods" | "zero-ready-endpoints";

export interface ServiceMismatchFinding {
  namespace: string;
  serviceName: string;
  reason: ServiceMismatchReason;
}

/**
 * Backlog #27: flags a Service that routes nowhere -- either its selector
 * matches zero pods in its own namespace (almost always a label typo or a
 * workload that was never deployed), or it matches pods but every one of
 * its current EndpointSlice backends is not-Ready (a health problem, not a
 * config one). Deliberately distinct from SPOF Radar's
 * findSingleReadyBackend (#24), which only flags exactly one Ready
 * backend -- zero is a different, more severe case that check never covers.
 *
 * A Service with no selector at all (manually-managed Endpoints, common for
 * external database proxies) or of type ExternalName is skipped outright --
 * neither has a selector concept to mismatch.
 */
export function findServiceSelectorMismatches(
  services: Record<string, unknown>[],
  pods: Record<string, unknown>[],
  endpointSlices: Record<string, unknown>[],
): ServiceMismatchFinding[] {
  const out: ServiceMismatchFinding[] = [];

  for (const svc of services) {
    const meta = rec(svc.metadata);
    const spec = rec(svc.spec);
    const namespace = str(meta.namespace);
    const serviceName = str(meta.name);

    if (str(spec.type) === "ExternalName") continue;
    const selectorMap = rec(spec.selector) as Record<string, string>;
    if (Object.keys(selectorMap).length === 0) continue;

    const selector: LabelSelector = { matchLabels: selectorMap };
    const matchingPods = pods.filter((p) => {
      const pm = rec(p.metadata);
      if (str(pm.namespace) !== namespace) return false;
      return matchesSelector(rec(pm.labels) as Record<string, string>, selector);
    });

    if (matchingPods.length === 0) {
      out.push({ namespace, serviceName, reason: "no-matching-pods" });
      continue;
    }

    const slices = endpointSlices.filter((es) => {
      const esMeta = rec(es.metadata);
      if (str(esMeta.namespace) !== namespace) return false;
      return str(rec(esMeta.labels)["kubernetes.io/service-name"]) === serviceName;
    });
    if (slices.length === 0) continue; // no EndpointSlice data available -- can't assess readiness

    let readyCount = 0;
    for (const slice of slices) {
      for (const ep of arr(slice.endpoints)) {
        const epRec = rec(ep);
        if (rec(epRec.conditions).ready !== false) readyCount += arr(epRec.addresses).length || 1;
      }
    }
    if (readyCount === 0) {
      out.push({ namespace, serviceName, reason: "zero-ready-endpoints" });
    }
  }

  return out;
}
