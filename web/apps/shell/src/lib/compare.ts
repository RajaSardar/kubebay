/**
 * Compare two resources (backlog 83): the pure parts. Turn the objects the
 * engine returns into comparable YAML text (noise stripped on request),
 * diff two texts as a unified diff, and word fetch failures. No React, no I/O.
 */

/** One object to compare: enough to fetch it from its cluster. */
export interface CompareRef {
  cluster: string;
  gvr: string;
  /** "" for a cluster-scoped object. */
  ns: string;
  name: string;
  /** The Kubernetes kind ("Deployment"), for display. */
  kind?: string;
}

import { lookupDef } from "./resources";

type Obj = Record<string, unknown>;

const NOISY_METADATA = ["managedFields", "resourceVersion", "uid", "generation", "creationTimestamp", "selfLink"];
const LAST_APPLIED = "kubectl.kubernetes.io/last-applied-configuration";

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A copy of the object for comparing. With `hideNoise`, drops what differs
 * between any two objects without meaning anything: managedFields,
 * resourceVersion, uid, generation, creationTimestamp, status and the
 * last-applied annotation. The input is never changed.
 */
export function normalizeObject(obj: Obj, hideNoise: boolean): Obj {
  const copy = JSON.parse(JSON.stringify(obj)) as Obj;
  if (!hideNoise) return copy;
  delete copy.status;
  const meta = copy.metadata;
  if (isObj(meta)) {
    for (const k of NOISY_METADATA) delete meta[k];
    if (isObj(meta.annotations)) {
      delete meta.annotations[LAST_APPLIED];
      if (Object.keys(meta.annotations).length === 0) delete meta.annotations;
    }
  }
  return copy;
}

function scalar(v: string | number | boolean | null): string {
  if (typeof v !== "string") return String(v);
  const needsQuote =
    v === "" ||
    /^(true|false|null|yes|no|on|off|y|n|~)$/i.test(v) ||
    /^[-+]?(\d[\d_]*)(\.\d+)?([eE][-+]?\d+)?$/.test(v) ||
    /^0[xo]/i.test(v) ||
    /^[\s\-?:,[\]{}#&*!|>'"%@`<]/.test(v) ||
    /\s$/.test(v) ||
    /: |:$| #|[\n\r\t]/.test(v);
  return needsQuote ? JSON.stringify(v) : v;
}

function lines(v: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) {
    return v.flatMap((item) => {
      if (isObj(item) ? Object.keys(item).length > 0 : Array.isArray(item) && item.length > 0) {
        const inner = lines(item, indent + 2);
        inner[0] = `${pad}- ${inner[0]!.slice(indent + 2)}`;
        return inner;
      }
      return [`${pad}- ${inline(item)}`];
    });
  }
  const o = v as Obj;
  return Object.keys(o)
    .sort()
    .flatMap((k) => {
      const val = o[k];
      const key = scalar(k);
      if (isObj(val) ? Object.keys(val).length > 0 : Array.isArray(val) && val.length > 0) {
        return [`${pad}${key}:`, ...lines(val, indent + 2)];
      }
      return [`${pad}${key}: ${inline(val)}`];
    });
}

function inline(v: unknown): string {
  if (Array.isArray(v)) return "[]";
  if (isObj(v)) return "{}";
  if (v === undefined) return "null";
  return scalar(v as string | number | boolean | null);
}

/** Block-style YAML with every map's keys sorted, so equal objects give equal text. */
export function toYaml(value: unknown): string {
  if (!isObj(value) && !Array.isArray(value)) return `${inline(value)}\n`;
  if (isObj(value) && Object.keys(value).length === 0) return "{}\n";
  return `${lines(value, 0).join("\n")}\n`;
}

type Op = { t: " " | "-" | "+"; s: string };

/**
 * Shortest edit script (Myers, O(ND)): cost follows how much differs, not how
 * long the files are, so two big objects with a few edits stay cheap. Null when
 * the sides differ by more than `maxD` lines; the caller then shows the middle
 * as replaced.
 */
function myers(a: string[], b: string[], maxD = 1500): Op[] | null {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return [...a.map((s): Op => ({ t: "-", s })), ...b.map((s): Op => ({ t: "+", s }))];
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1]! < v[off + k + 1]!) ? v[off + k + 1]! : v[off + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return null;
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const pv = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && pv[off + k - 1]! < pv[off + k + 1]!) ? k + 1 : k - 1;
    const prevX = pv[off + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ t: " ", s: a[x - 1]! });
      x--;
      y--;
    }
    if (x === prevX) ops.push({ t: "+", s: b[y - 1]! });
    else ops.push({ t: "-", s: a[x - 1]! });
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push({ t: " ", s: a[x - 1]! });
    x--;
    y--;
  }
  return ops.reverse();
}

function diffOps(a: string[], b: string[]): Op[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;
  const am = a.slice(pre, a.length - suf);
  const bm = b.slice(pre, b.length - suf);
  const mid = myers(am, bm) ?? [...am.map((s): Op => ({ t: "-", s })), ...bm.map((s): Op => ({ t: "+", s }))];
  return [
    ...a.slice(0, pre).map((s): Op => ({ t: " ", s })),
    ...mid,
    ...a.slice(a.length - suf).map((s): Op => ({ t: " ", s })),
  ];
}

const splitLines = (t: string) => (t === "" ? [] : t.replace(/\n$/, "").split("\n"));

/** The two texts as unified diff text (3 lines of context); "" when they are equal. */
export function unifiedDiff(a: string, b: string, aLabel: string, bLabel: string, context = 3): string {
  const ops = diffOps(splitLines(a), splitLines(b));
  const changed = ops.flatMap((o, i) => (o.t === " " ? [] : [i]));
  if (changed.length === 0) return "";
  // Merge changes whose context windows touch into hunks of [from, to) op indexes.
  const hunks: [number, number][] = [];
  for (const i of changed) {
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length, i + context + 1);
    const last = hunks[hunks.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else hunks.push([from, to]);
  }
  // Line numbers (1-based) of each op on either side.
  const aAt: number[] = [];
  const bAt: number[] = [];
  let ai = 1;
  let bi = 1;
  for (const o of ops) {
    aAt.push(ai);
    bAt.push(bi);
    if (o.t !== "+") ai++;
    if (o.t !== "-") bi++;
  }
  const out = [`--- ${aLabel}`, `+++ ${bLabel}`];
  for (const [from, to] of hunks) {
    const slice = ops.slice(from, to);
    const aCount = slice.filter((o) => o.t !== "+").length;
    const bCount = slice.filter((o) => o.t !== "-").length;
    const aStart = aCount === 0 ? aAt[from]! - 1 : aAt[from]!;
    const bStart = bCount === 0 ? bAt[from]! - 1 : bAt[from]!;
    out.push(`@@ -${aStart},${aCount} +${bStart},${bCount} @@`);
    for (const o of slice) out.push(`${o.t}${o.s}`);
  }
  return `${out.join("\n")}\n`;
}

/** "dev: shop/api", or "dev: api" for a cluster-scoped object. */
export function refLabel(r: CompareRef): string {
  return `${r.cluster}: ${r.ns ? `${r.ns}/` : ""}${r.name}`;
}

export const sameRef = (a: CompareRef, b: CompareRef): boolean =>
  a.cluster === b.cluster && a.gvr === b.gvr && a.ns === b.ns && a.name === b.name;

/** What went wrong reading one side, in words a person can act on. */
export function compareErrorMessage(e: unknown, r: CompareRef): string {
  const text = e instanceof Error ? e.message : String(e);
  const name = e instanceof Error ? e.name : "";
  if (name === "ObjectNotFoundError") return `${refLabel(r)} was not found: it may have been deleted.`;
  if (/forbidden/i.test(text)) {
    return `You are not allowed to read ${refLabel(r)}. Your own access on that cluster decides this. ${text.replace(/^get:\s*/, "")}`.trim();
  }
  return `Could not read ${refLabel(r)}: ${text.replace(/^get:\s*/, "")}`;
}

/** A search hit (palette index or engine) as a ref; null when its kind is unknown. */
export function refFromObject(o: { cluster: string; slug: string; ns: string; name: string; clusterScoped?: boolean }): CompareRef | null {
  const def = lookupDef(o.slug, new URLSearchParams(o.clusterScoped ? "scoped=0" : ""));
  if (!def) return null;
  return { cluster: o.cluster, gvr: def.gvr, ns: o.ns, name: o.name, kind: def.kind };
}

/** A table's row key ("ns/name", "/name" for a cluster-scoped object) as a ref. */
export function refFromRowKey(key: string, cluster: string, gvr: string, kind?: string): CompareRef {
  const i = key.indexOf("/");
  return { cluster, gvr, ns: key.slice(0, i), name: key.slice(i + 1), ...(kind ? { kind } : {}) };
}
