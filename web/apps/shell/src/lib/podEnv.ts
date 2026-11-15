function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

// Resolves a `valueFrom.fieldRef.fieldPath` against the pod's own live
// object — the same set of paths Kubernetes' downward API supports
// (metadata.name, metadata.namespace, spec.nodeName, status.podIP, …),
// plus the `metadata.labels['x']`/`metadata.annotations['x']` map-key form.
export function resolveFieldRef(pod: Record<string, unknown>, fieldPath: string): string | null {
  const mapMatch = /^(metadata\.(?:labels|annotations))\['([^']+)'\]$/.exec(fieldPath);
  if (mapMatch) {
    const [, mapPath, key] = mapMatch;
    const map = rec(walk(pod, mapPath!));
    const value = map[key!];
    return typeof value === "string" ? value : null;
  }

  const value = walk(pod, fieldPath);
  if (typeof value === "string" || typeof value === "number") return String(value);
  return null;
}

function walk(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

export interface ResourceFieldRef {
  resource: string;
  divisor?: string;
}

// Parses a Kubernetes quantity suffix (Ki/Mi/Gi/Ti or plain bytes, and the
// bare "m" millicores suffix for cpu) into a plain number, matching the
// small subset of the quantity grammar this app already needs elsewhere.
function quantityToNumber(q: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)([a-zA-Z]*)$/.exec(q.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const suffix = m[2];
  const table: Record<string, number> = {
    "": 1,
    m: 0.001,
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
  };
  const mult = table[suffix ?? ""];
  return mult === undefined ? null : n * mult;
}

// Resolves a `valueFrom.resourceFieldRef` (e.g. "requests.cpu",
// "limits.memory") against one container's own resources block, applying
// the ref's divisor the way Kubernetes does before exposing it as an env
// value. Returns the raw quantity string when there's no divisor (the
// common case), or a computed number string when one is given.
export function resolveResourceFieldRef(
  container: { resources?: { requests?: Record<string, string>; limits?: Record<string, string> } },
  ref: ResourceFieldRef,
): string | null {
  const [bucket, name] = ref.resource.split(".");
  if (!bucket || !name || (bucket !== "requests" && bucket !== "limits")) return null;

  const raw = container.resources?.[bucket]?.[name];
  if (raw === undefined) return null;

  if (!ref.divisor) return raw;

  const value = quantityToNumber(raw);
  const divisor = quantityToNumber(ref.divisor);
  if (value === null || !divisor) return null;

  return String(Math.ceil(value / divisor));
}
