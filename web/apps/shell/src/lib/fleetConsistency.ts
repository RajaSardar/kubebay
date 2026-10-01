/**
 * Intelligence roadmap Tier 3 #25: Fleet Consistency Diff. The same workload
 * or ConfigMap (kind + namespace + name) compared across clusters, field by
 * field, scoped to the classes where drift bites: Deployments, StatefulSets,
 * DaemonSets and ConfigMaps. Pure: the Fleet page feeds it streamed objects.
 *
 * Secret-backed env vars are shown by reference (secret name/key), never by
 * value; Secrets themselves are not compared.
 */

type Obj = Record<string, unknown>;

export interface ClusterObjects {
  cluster: string;
  objects: { deployments: unknown[]; statefulsets: unknown[]; daemonsets: unknown[]; configmaps: unknown[] };
}

export type DriftSeverity = "high" | "medium" | "low";
export type ConsistencyKind = "Deployment" | "StatefulSet" | "DaemonSet" | "ConfigMap";

export interface FieldDrift {
  path: string;
  severity: DriftSeverity;
  /** Each holding cluster's value; undefined where the field is absent. */
  values: Record<string, string | undefined>;
}

export interface ObjectDrift {
  kind: ConsistencyKind;
  namespace: string;
  name: string;
  /** Clusters that hold the object, in input order. */
  clusters: string[];
  fields: FieldDrift[];
}

export interface MissingObject {
  kind: ConsistencyKind;
  namespace: string;
  name: string;
  presentIn: string[];
  missingFrom: string[];
}

export interface FleetConsistency {
  /** Objects held by at least two clusters, i.e. actually compared. */
  compared: number;
  drifts: ObjectDrift[];
  missing: MissingObject[];
}

const SEVERITY_RANK: Record<DriftSeverity, number> = { high: 0, medium: 1, low: 2 };

/** ConfigMaps every cluster mints with its own content. */
const PER_CLUSTER_CONFIGMAPS = new Set(["kube-root-ca.crt"]);

function rec(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? v.map(rec) : [];
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  return typeof v === "string" ? v : JSON.stringify(v);
}

function envValue(e: Obj): string | undefined {
  if (e.value !== undefined) return str(e.value);
  const from = rec(e.valueFrom);
  const sec = rec(from.secretKeyRef);
  if (sec.name || sec.key) return `secret ${str(sec.name) ?? ""}/${str(sec.key) ?? ""}`;
  const cfg = rec(from.configMapKeyRef);
  if (cfg.name || cfg.key) return `configmap ${str(cfg.name) ?? ""}/${str(cfg.key) ?? ""}`;
  const field = rec(from.fieldRef);
  if (field.fieldPath) return `field ${str(field.fieldPath)}`;
  const res = rec(from.resourceFieldRef);
  if (res.resource) return `resource ${str(res.resource)}`;
  return "";
}

type Fields = Map<string, { value: string; severity: DriftSeverity }>;

function containerFields(out: Fields, prefix: string, c: Obj) {
  const at = `${prefix}[${str(c.name) ?? ""}]`;
  out.set(`${at}.image`, { value: str(c.image) ?? "", severity: "high" });
  const resources = rec(c.resources);
  for (const section of ["requests", "limits"]) {
    const r = rec(resources[section]);
    for (const k of Object.keys(r).sort()) out.set(`${at}.resources.${section}.${k}`, { value: str(r[k]) ?? "", severity: "medium" });
  }
  const env = arr(c.env).slice().sort((a, b) => (str(a.name) ?? "").localeCompare(str(b.name) ?? ""));
  for (const e of env) out.set(`${at}.env.${str(e.name) ?? ""}`, { value: envValue(e) ?? "", severity: "medium" });
}

function workloadFields(o: Obj, kind: ConsistencyKind): { fields: Fields; containers: Map<string, string> } {
  const spec = rec(o.spec);
  const pod = rec(rec(spec.template).spec);
  const fields: Fields = new Map();
  const containers = new Map<string, string>();
  for (const prefix of ["initContainers", "containers"]) {
    for (const c of arr(pod[prefix])) {
      containers.set(`${prefix}[${str(c.name) ?? ""}]`, str(c.image) ?? "");
      containerFields(fields, prefix, c);
    }
  }
  if (kind !== "DaemonSet" && spec.replicas !== undefined) fields.set("replicas", { value: str(spec.replicas) ?? "", severity: "low" });
  return { fields, containers };
}

function configMapFields(o: Obj): Fields {
  const fields: Fields = new Map();
  for (const section of ["data", "binaryData"]) {
    const d = rec(o[section]);
    for (const k of Object.keys(d).sort()) fields.set(`${section}.${k}`, { value: str(d[k]) ?? "", severity: "medium" });
  }
  return fields;
}

interface Held {
  cluster: string;
  fields: Fields;
  containers: Map<string, string>;
}

const KINDS: { kind: ConsistencyKind; key: keyof ClusterObjects["objects"] }[] = [
  { kind: "Deployment", key: "deployments" },
  { kind: "StatefulSet", key: "statefulsets" },
  { kind: "DaemonSet", key: "daemonsets" },
  { kind: "ConfigMap", key: "configmaps" },
];

function diffHeld(held: Held[]): FieldDrift[] {
  const out: FieldDrift[] = [];
  const clusters = held.map((h) => h.cluster);

  // Containers some clusters lack: one presence row each, not a row per field.
  const partial = new Set<string>();
  const containerOrder: string[] = [];
  for (const h of held) for (const c of h.containers.keys()) if (!containerOrder.includes(c)) containerOrder.push(c);
  for (const c of containerOrder) {
    if (held.every((h) => h.containers.has(c))) continue;
    partial.add(c);
    out.push({ path: c, severity: "high", values: Object.fromEntries(held.map((h) => [h.cluster, h.containers.get(c)])) });
  }

  const paths: string[] = [];
  const seen = new Set<string>();
  for (const h of held) for (const p of h.fields.keys()) if (!seen.has(p)) { seen.add(p); paths.push(p); }
  for (const p of paths) {
    if ([...partial].some((c) => p.startsWith(`${c}.`))) continue;
    const values: Record<string, string | undefined> = {};
    let severity: DriftSeverity = "low";
    for (const h of held) {
      const f = h.fields.get(p);
      values[h.cluster] = f?.value;
      if (f) severity = f.severity;
    }
    const distinct = new Set(clusters.map((c) => values[c] ?? "\u0000absent"));
    if (distinct.size > 1) out.push({ path: p, severity, values });
  }
  return out.map((f, i) => ({ f, i })).sort((a, b) => SEVERITY_RANK[a.f.severity] - SEVERITY_RANK[b.f.severity] || a.i - b.i).map(({ f }) => f);
}

export function compareFleet(input: ClusterObjects[]): FleetConsistency {
  const namespacesBy = new Map<string, Set<string>>();
  const byKey = new Map<string, { kind: ConsistencyKind; namespace: string; name: string; held: Held[] }>();

  for (const { cluster, objects } of input) {
    const nsSet = new Set<string>();
    namespacesBy.set(cluster, nsSet);
    for (const { kind, key } of KINDS) {
      for (const raw of objects[key] ?? []) {
        const o = rec(raw);
        const meta = rec(o.metadata);
        const namespace = str(meta.namespace) ?? "";
        const name = str(meta.name) ?? "";
        if (!name) continue;
        nsSet.add(namespace);
        if (namespace.startsWith("kube-")) continue;
        if (kind === "ConfigMap" && PER_CLUSTER_CONFIGMAPS.has(name)) continue;
        const id = `${kind}/${namespace}/${name}`;
        const entry = byKey.get(id) ?? { kind, namespace, name, held: [] };
        const w = kind === "ConfigMap" ? { fields: configMapFields(o), containers: new Map<string, string>() } : workloadFields(o, kind);
        entry.held.push({ cluster, ...w });
        byKey.set(id, entry);
      }
    }
  }

  let compared = 0;
  const drifts: ObjectDrift[] = [];
  const missing: MissingObject[] = [];
  for (const e of byKey.values()) {
    const presentIn = e.held.map((h) => h.cluster);
    const missingFrom = input
      .map((c) => c.cluster)
      .filter((c) => !presentIn.includes(c) && namespacesBy.get(c)?.has(e.namespace));
    if (missingFrom.length) missing.push({ kind: e.kind, namespace: e.namespace, name: e.name, presentIn, missingFrom });
    if (e.held.length < 2) continue;
    compared++;
    const fields = diffHeld(e.held);
    if (fields.length) drifts.push({ kind: e.kind, namespace: e.namespace, name: e.name, clusters: presentIn, fields });
  }

  const worst = (d: ObjectDrift) => Math.min(...d.fields.map((f) => SEVERITY_RANK[f.severity]));
  const ident = (a: { kind: string; namespace: string; name: string }) => `${a.kind}/${a.namespace}/${a.name}`;
  drifts.sort((a, b) => worst(a) - worst(b) || b.fields.length - a.fields.length || ident(a).localeCompare(ident(b)));
  missing.sort((a, b) => ident(a).localeCompare(ident(b)));
  return { compared, drifts, missing };
}
