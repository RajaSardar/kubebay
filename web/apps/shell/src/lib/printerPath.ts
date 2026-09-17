// Minimal JSONPath support for CRD printer columns. Kubernetes only allows a
// restricted subset in additionalPrinterColumns, and in practice operators use
// two shapes: a plain dot path, and a filter predicate to pull one entry out of
// a conditions array (`.status.conditions[?(@.type=="Ready")].status`, which is
// how Karpenter and most controllers define their Ready column). Anything more
// exotic yields "" rather than pulling in a full JSONPath engine.

type Step =
  | { kind: "key"; key: string }
  | { kind: "filter"; key: string[]; value: string };

const FILTER_RE = /^\[\?\(@\.([A-Za-z0-9_.\-/]+)\s*==\s*(["'])(.*?)\2\)\]/;

export function parsePrinterPath(raw: string): Step[] | null {
  const path = raw.replace(/^\{/, "").replace(/\}$/, "").trim();
  if (!path.startsWith(".")) return null;

  const steps: Step[] = [];
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i += 1;
      const start = i;
      while (i < path.length && path[i] !== "." && path[i] !== "[") i += 1;
      const key = path.slice(start, i);
      if (!key) return null;
      steps.push({ kind: "key", key });
      continue;
    }
    if (path[i] === "[") {
      const m = FILTER_RE.exec(path.slice(i));
      if (!m || !m[1] || m[3] === undefined) return null;
      steps.push({ kind: "filter", key: m[1].split("."), value: m[3] });
      i += m[0].length;
      continue;
    }
    return null;
  }
  return steps.length ? steps : null;
}

function get(obj: unknown, keys: string[]): unknown {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export function evalPrinterPath(raw: string, obj: unknown): string {
  const steps = parsePrinterPath(raw);
  if (!steps) return "";

  let cur: unknown = obj;
  for (const step of steps) {
    if (cur == null) return "";
    if (step.kind === "key") {
      if (typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[step.key];
    } else {
      if (!Array.isArray(cur)) return "";
      cur = cur.find((el) => {
        const v = get(el, step.key);
        return v != null && String(v) === step.value;
      });
    }
  }

  if (cur == null) return "";
  if (typeof cur === "boolean") return cur ? "True" : "False";
  if (typeof cur === "object") return JSON.stringify(cur);
  return String(cur);
}
