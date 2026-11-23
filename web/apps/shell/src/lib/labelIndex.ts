type Obj = Record<string, unknown>;

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

interface Entry<T> {
  obj: T;
  labels: Record<string, unknown>;
}

/**
 * Objects grouped by namespace and by each label pair, built once per stream
 * change so a join over workloads or Services asks "which pods carry these
 * labels in this namespace" without scanning every pod each time.
 */
export class LabelIndex<T extends Obj = Obj> {
  private byNs = new Map<string, Entry<T>[]>();
  private byPair = new Map<string, Entry<T>[]>();

  constructor(objs: readonly T[]) {
    for (const obj of objs) {
      const meta = rec(obj.metadata);
      const ns = typeof meta.namespace === "string" ? meta.namespace : "";
      const labels = rec(meta.labels);
      const e = { obj, labels };
      push(this.byNs, ns, e);
      for (const [k, v] of Object.entries(labels)) {
        if (typeof v === "string") push(this.byPair, pairKey(ns, k, v), e);
      }
    }
  }

  /** Every object in `ns`, with its labels. */
  inNamespace(ns: string): readonly Entry<T>[] {
    return this.byNs.get(ns) ?? [];
  }

  /**
   * The objects in `ns` whose labels include every pair of `match` (all of
   * `ns` when `match` is empty), narrowed by `also` when given.
   */
  select(ns: string, match: Readonly<Record<string, string>>, also?: (labels: Record<string, string>) => boolean): T[] {
    const pairs = Object.entries(match);
    let candidates: readonly Entry<T>[] = this.inNamespace(ns);
    for (const [k, v] of pairs) {
      const list = this.byPair.get(pairKey(ns, k, v));
      if (!list) return [];
      if (list.length < candidates.length) candidates = list;
    }
    const out: T[] = [];
    for (const e of candidates) {
      if (pairs.every(([k, v]) => e.labels[k] === v) && (!also || also(e.labels as Record<string, string>))) out.push(e.obj);
    }
    return out;
  }
}

/** Objects by "namespace/value of label `key`", e.g. EndpointSlices by their Service. */
export function groupByLabel<T extends Obj>(objs: readonly T[], key: string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const obj of objs) {
    const meta = rec(obj.metadata);
    const v = rec(meta.labels)[key];
    if (typeof v !== "string") continue;
    push(m, `${typeof meta.namespace === "string" ? meta.namespace : ""}/${v}`, obj);
  }
  return m;
}

/** Objects by namespace. */
export function groupByNamespace<T extends Obj>(objs: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const obj of objs) {
    const ns = rec(obj.metadata).namespace;
    push(m, typeof ns === "string" ? ns : "", obj);
  }
  return m;
}

function pairKey(ns: string, k: string, v: string): string {
  return `${ns}\u0000${k}\u0000${v}`;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}
