/** A Kubernetes LabelSelector (matchLabels + matchExpressions). */
export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
}

/**
 * A LabelSelector as the string the API server's `labelSelector` takes:
 * `app=web,env in (prod,staging),!legacy`. Empty when it selects on nothing.
 */
export function selectorString(sel: LabelSelector | undefined): string {
  if (!sel) return "";
  const parts = Object.entries(sel.matchLabels ?? {}).map(([k, v]) => `${k}=${v}`);
  for (const e of sel.matchExpressions ?? []) {
    const values = (e.values ?? []).join(",");
    switch (e.operator) {
      case "In":
        parts.push(`${e.key} in (${values})`);
        break;
      case "NotIn":
        parts.push(`${e.key} notin (${values})`);
        break;
      case "Exists":
        parts.push(e.key);
        break;
      case "DoesNotExist":
        parts.push(`!${e.key}`);
        break;
    }
  }
  return parts.join(",");
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/**
 * The Pods page scoped to one workload's pods (its namespace and selector), or
 * null when the workload selects on nothing. `kind` names it in the chip.
 */
export function podsOfWorkloadPath(obj: Record<string, unknown>, kind: string): string | null {
  const meta = rec(obj.metadata);
  const sel = selectorString(rec(obj.spec).selector as LabelSelector | undefined);
  if (!sel) return null;
  const q = new URLSearchParams({ ns: String(meta.namespace ?? ""), selector: sel, of: `${kind}/${String(meta.name ?? "")}` });
  return `/workloads?${q.toString()}`;
}
