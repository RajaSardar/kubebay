import { statusTone, type StatusTone } from "@kubebay/ui";
import { podResources, type PodResources } from "./podUsage";

/**
 * The container Logs and Terminal open on: the one the pod's
 * `kubectl.kubernetes.io/default-container` annotation names (as kubectl does),
 * else the first. An annotation naming a container the pod lacks is ignored.
 */
export function defaultContainer(obj: Record<string, unknown> | undefined, containers: string[]): string | undefined {
  const meta = (obj?.metadata ?? {}) as { annotations?: Record<string, string> };
  const want = meta.annotations?.["kubectl.kubernetes.io/default-container"];
  return want && containers.includes(want) ? want : containers[0];
}

/** One row of the Pods table, derived from a Pod object. */
export interface PodRow {
  key: string;
  name: string;
  namespace: string;
  ready: string;
  status: "running" | "succeeded" | "pending" | "failed" | "warning";
  statusLabel: string;
  restarts: number;
  containers: string[];
  node: string;
  podIP: string;
  /** Creation time, for the age tooltip. */
  created: string;
  /** Labels, for `label:app=web` in the filter. */
  labels: Readonly<Record<string, string>>;
  /** resourceVersion: a new one with changed columns briefly tints the row. */
  rv: string;
  /** The waiting reason's message (why it is CrashLoopBackOff), for the status tooltip. */
  statusDetail: string;
  /** Requests and limits, which the CPU and memory bars measure against. */
  resources: PodResources;
}

function asRecord(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

// Derived rows by pod object. A stream keeps a pod's object while it is
// unchanged and replaces it (a freshly decoded one) when it changes, so the
// object is the cache key; a WeakMap lets a removed pod's entry go with it.
// The resourceVersion is checked too, in case an object is ever edited in place.
const cache = new WeakMap<object, { rv: unknown; row: PodRow | null }>();

/**
 * The Pods table's view of a Pod: its status (a waiting reason such as
 * CrashLoopBackOff wins over the phase, and its message becomes the tooltip),
 * ready and restart counts, placement, and requests/limits for the usage bars.
 * Cached per object: the row depends on nothing but the object (age is shown
 * from `created`, not stored), so a flush with no changes derives nothing.
 */
export function derivePod(obj: Record<string, unknown>): PodRow | null {
  const rv = (obj.metadata as { resourceVersion?: unknown } | undefined)?.resourceVersion;
  const hit = cache.get(obj);
  if (hit && hit.rv === rv) return hit.row;
  const row = computePod(obj);
  cache.set(obj, { rv, row });
  return row;
}

function computePod(obj: Record<string, unknown>): PodRow | null {
  const meta = asRecord(obj.metadata);
  const name = meta.name as string | undefined;
  const namespace = (meta.namespace as string) ?? "default";
  if (!name) return null;

  const spec = asRecord(obj.spec);
  const status = asRecord(obj.status);
  const containers = (spec.containers ?? []) as unknown[];
  const containerStatuses = (status.containerStatuses ?? []) as Record<string, unknown>[];

  const readyCount = containerStatuses.filter((cs) => cs.ready === true).length;
  const restarts = containerStatuses.reduce((acc, cs) => acc + ((cs.restartCount as number) ?? 0), 0);

  const phase = (status.phase as string) ?? "Unknown";
  let state: PodRow["status"] = "pending";
  let label = phase;
  let detail = (status.message as string) ?? "";

  if (meta.deletionTimestamp) {
    state = "pending";
    label = "Terminating";
  } else {
    for (const cs of containerStatuses) {
      const waiting = asRecord(asRecord(cs.state).waiting);
      const reason = waiting.reason as string | undefined;
      if (reason && reason !== "ContainerCreating") {
        state = "failed";
        label = reason;
        detail = (waiting.message as string) ?? detail;
        break;
      }
    }
    if (state !== "failed") {
      if (phase === "Running" && containers.length > 0 && readyCount === containers.length) {
        state = "running";
        label = "Running";
      } else if (phase === "Succeeded") {
        state = "succeeded";
      } else if (phase === "Failed") {
        state = "failed";
      }
    }
  }

  const containerNames = [
    ...new Set([
      ...containerStatuses.map((cs) => cs.name as string).filter(Boolean),
      ...((spec.containers ?? []) as Record<string, unknown>[]).map((c) => asRecord(c).name as string).filter(Boolean),
    ]),
  ];

  return {
    key: `${namespace}/${name}`,
    name,
    namespace,
    ready: `${readyCount}/${containerNames.length || "?"}`,
    status: state,
    statusLabel: label,
    restarts,
    containers: containerNames,
    node: (spec.nodeName as string) ?? "",
    podIP: (status.podIP as string) ?? "",
    created: (meta.creationTimestamp as string) ?? "",
    labels: (meta.labels as Record<string, string> | undefined) ?? {},
    rv: (meta.resourceVersion as string) ?? "",
    statusDetail: detail,
    resources: podResources(obj),
  };
}

/**
 * The tone a pod's status pill takes: the status word's own tone, except that
 * a Running pod with containers not ready is a warning, not the green of
 * a healthy one.
 */
export function podTone(p: Pick<PodRow, "status" | "statusLabel">): StatusTone {
  if (p.statusLabel === "Running" && p.status !== "running") return "warn";
  return statusTone(p.statusLabel);
}
