import { useMemo } from "react";
import { useResourceStream } from "./useResourceStream";

export interface OwnerLink {
  kind: string;
  name: string;
  /** URL slug for the resource table, e.g. "replicasets" */
  slug: string;
  ns: string;
}

/** Maps "apiVersion/Kind" → GVR for resources that commonly appear in owner chains. */
const OWNER_GVR: Record<string, string> = {
  "apps/v1/ReplicaSet": "apps/v1/replicasets",
  "apps/v1/Deployment": "apps/v1/deployments",
  "apps/v1/StatefulSet": "apps/v1/statefulsets",
  "apps/v1/DaemonSet": "apps/v1/daemonsets",
  "batch/v1/Job": "batch/v1/jobs",
  "batch/v1/CronJob": "batch/v1/cronjobs",
};

/** Derives a URL slug from a Kubernetes Kind string. */
export function kindSlug(kind: string): string {
  const overrides: Record<string, string> = {
    StatefulSet: "statefulsets",
    DaemonSet: "daemonsets",
    ReplicaSet: "replicasets",
    CronJob: "cronjobs",
  };
  return overrides[kind] ?? kind.toLowerCase() + "s";
}

interface RawOwnerRef {
  apiVersion?: string;
  kind: string;
  name: string;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/**
 * Follows the ownerReferences chain upward from `initialOwnerRefs`,
 * resolving each level using pre-loaded resource streams.
 *
 * Returns a flat array of owner links from immediate to root, e.g.:
 *   [ReplicaSet/web-abc, Deployment/web]
 */
export function useOwnerChain(
  cluster: string,
  namespace: string,
  initialOwnerRefs: RawOwnerRef[],
): OwnerLink[] {
  const replicasets = useResourceStream(cluster, "apps/v1/replicasets", { ns: [namespace], mode: "full" });
  const deployments = useResourceStream(cluster, "apps/v1/deployments", { ns: [namespace], mode: "full" });
  const statefulsets = useResourceStream(cluster, "apps/v1/statefulsets", { ns: [namespace], mode: "full" });
  const daemonsets = useResourceStream(cluster, "apps/v1/daemonsets", { ns: [namespace], mode: "full" });
  const jobs = useResourceStream(cluster, "batch/v1/jobs", { ns: [namespace], mode: "full" });
  const cronjobs = useResourceStream(cluster, "batch/v1/cronjobs", { ns: [namespace], mode: "full" });

  return useMemo(() => {
    const streams: Record<string, Record<string, unknown>[]> = {
      "apps/v1/replicasets": replicasets.rows,
      "apps/v1/deployments": deployments.rows,
      "apps/v1/statefulsets": statefulsets.rows,
      "apps/v1/daemonsets": daemonsets.rows,
      "batch/v1/jobs": jobs.rows,
      "batch/v1/cronjobs": cronjobs.rows,
    };

    const chain: OwnerLink[] = [];
    let current: RawOwnerRef[] = initialOwnerRefs;
    const seen = new Set<string>();
    const MAX_DEPTH = 5;

    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      if (!current.length) break;

      // Follow the controller owner (controller: true) if present, else first
      const ownerRef =
        (current as (RawOwnerRef & { controller?: boolean })[]).find((o) => o.controller) ?? current[0];
      if (!ownerRef) break;

      const dedupeKey = `${ownerRef.kind}/${ownerRef.name}`;
      if (seen.has(dedupeKey)) break;
      seen.add(dedupeKey);

      chain.push({
        kind: ownerRef.kind,
        name: ownerRef.name,
        slug: kindSlug(ownerRef.kind),
        ns: namespace,
      });

      // Look up this owner's object to read its ownerReferences
      const gvr = OWNER_GVR[`${ownerRef.apiVersion ?? ""}/${ownerRef.kind}`];
      if (!gvr) break;

      const rows = streams[gvr] ?? [];
      const ownerObj = rows.find((r) => rec(rec(r).metadata).name === ownerRef.name);
      if (!ownerObj) break;

      current = (rec(rec(ownerObj).metadata).ownerReferences as RawOwnerRef[] | undefined) ?? [];
    }

    return chain;
  }, [
    initialOwnerRefs,
    namespace,
    replicasets.rows,
    deployments.rows,
    statefulsets.rows,
    daemonsets.rows,
    jobs.rows,
    cronjobs.rows,
  ]);
}
