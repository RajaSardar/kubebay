export interface MatchExpression {
  key: string;
  operator: "In" | "NotIn" | "Exists" | "DoesNotExist" | string;
  values?: string[];
}

export interface LabelSelector {
  matchLabels?: Record<string, string>;
  matchExpressions?: MatchExpression[];
}

/**
 * A standard Kubernetes LabelSelector matcher (matchLabels + matchExpressions),
 * used to conservatively estimate PDB coverage for the Karpenter impact
 * banner: does a PDB's own selector actually cover this pod, or just happen
 * to live in the same namespace.
 */
export function matchesSelector(labels: Record<string, string>, selector: LabelSelector): boolean {
  for (const [k, v] of Object.entries(selector.matchLabels ?? {})) {
    if (labels[k] !== v) return false;
  }
  for (const expr of selector.matchExpressions ?? []) {
    const has = Object.prototype.hasOwnProperty.call(labels, expr.key);
    switch (expr.operator) {
      case "In":
        if (!has || !(expr.values ?? []).includes(labels[expr.key]!)) return false;
        break;
      case "NotIn":
        if (has && (expr.values ?? []).includes(labels[expr.key]!)) return false;
        break;
      case "Exists":
        if (!has) return false;
        break;
      case "DoesNotExist":
        if (has) return false;
        break;
      default:
        return false;
    }
  }
  return true;
}

/**
 * A LabelSelector as the string `?labelSelector=` takes, for asking the
 * engine about one workload's pods. Null for an empty selector (it would
 * select every pod) or an operator this doesn't know (it would come out
 * broader than the real selector).
 */
export function selectorQuery(selector: LabelSelector | undefined): string | null {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(selector?.matchLabels ?? {})) parts.push(`${k}=${v}`);
  for (const expr of selector?.matchExpressions ?? []) {
    const values = (expr.values ?? []).join(",");
    switch (expr.operator) {
      case "In":
        parts.push(`${expr.key} in (${values})`);
        break;
      case "NotIn":
        parts.push(`${expr.key} notin (${values})`);
        break;
      case "Exists":
        parts.push(expr.key);
        break;
      case "DoesNotExist":
        parts.push(`!${expr.key}`);
        break;
      default:
        return null;
    }
  }
  return parts.length > 0 ? parts.join(",") : null;
}
