import { derivePod, type PodRow } from "./pods";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The uid of an object's controlling owner, or "" when it has none. */
function controllerUid(obj: Record<string, unknown>): string {
  const refs = rec(obj.metadata).ownerReferences;
  if (!Array.isArray(refs)) return "";
  const c = refs.map(rec).find((r) => r.controller === true);
  return c ? str(c.uid) : "";
}

/**
 * `matchLabels` of a workload's selector as a label selector string, for
 * narrowing the pods stream. Selectors with only expressions give "", which
 * means the namespace's pods are streamed and the owner chain filters them.
 */
export function workloadLabelSelector(obj: Record<string, unknown>): string {
  const ml = rec(rec(rec(obj.spec).selector).matchLabels);
  return Object.entries(ml)
    .filter(([, v]) => typeof v === "string")
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

const collator = new Intl.Collator(undefined, { numeric: true });

/**
 * The pods a workload owns, as Pods-table rows sorted by name. Ownership is the
 * controller chain by uid, as Kubernetes itself does: a StatefulSet, DaemonSet
 * or Job owns its pods directly, a Deployment owns them through its
 * ReplicaSets (pass the namespace's ReplicaSets for a Deployment).
 */
export function workloadPods(
  workload: Record<string, unknown>,
  pods: Record<string, unknown>[],
  replicaSets: Record<string, unknown>[],
): PodRow[] {
  const meta = rec(workload.metadata);
  const uid = str(meta.uid);
  const ns = str(meta.namespace);
  if (!uid) return [];
  const owned = new Set<string>([uid]);
  if (str(workload.kind) === "Deployment") {
    for (const rs of replicaSets) {
      if (controllerUid(rs) === uid) owned.add(str(rec(rs.metadata).uid));
    }
    owned.delete("");
  }
  const rows: PodRow[] = [];
  for (const p of pods) {
    if (ns && str(rec(p.metadata).namespace) !== ns) continue;
    if (!owned.has(controllerUid(p))) continue;
    const row = derivePod(p);
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => collator.compare(a.name, b.name));
}
