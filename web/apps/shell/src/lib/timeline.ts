// The Changes page's pure parts (backlog 82): the query it sends, where the
// "not recorded" bands sit, how a change's field paths read, and where a row
// opens. No values are ever here: the engine keeps paths and managers only.

import { auditObjectHref } from "./auditLinks";

export interface TimelineField {
  path: string;
  kind: "added" | "removed" | "changed";
}

export interface TimelineChange {
  id: number;
  cluster: string;
  ts: string;
  objTime?: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespace: string;
  name: string;
  uid?: string;
  op: "add" | "update" | "delete" | "event";
  fieldManager?: string;
  fields?: TimelineField[];
  moreFields?: number;
  metadataOnly?: boolean;
  afterGap?: boolean;
  merged?: number;
  reason?: string;
  type?: string;
  message?: string;
  involvedKind?: string;
  involvedName?: string;
}

export interface TimelineGap {
  from: string;
  to: string;
  reason: string;
}

export interface TimelineCoverage {
  kind: string;
  gaps: TimelineGap[];
}

export interface TimelineFilters {
  cluster: string;
  namespace?: string;
  kind?: string;
  manager?: string;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export function changesQuery(f: TimelineFilters): string {
  const parts: [string, string][] = [["cluster", f.cluster]];
  for (const k of ["namespace", "kind", "manager", "from", "to", "cursor"] as const) {
    const v = f[k];
    if (v) parts.push([k, v]);
  }
  if (f.limit) parts.push(["limit", String(f.limit)]);
  return parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

export interface Band {
  /** Percent from the window's left edge. */
  left: number;
  /** Percent of the window. */
  width: number;
  reason: string;
  from: string;
  to: string;
}

/** Each gap as a band of the [from, to] window, clipped to it; gaps outside it are dropped. */
export function layoutBands(gaps: TimelineGap[], from: string, to: string): Band[] {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (!(b > a)) return [];
  const span = b - a;
  const out: Band[] = [];
  for (const g of gaps) {
    const s = Math.max(Date.parse(g.from), a);
    const e = Math.min(Date.parse(g.to), b);
    if (!(e > s)) continue;
    out.push({ left: ((s - a) / span) * 100, width: ((e - s) / span) * 100, reason: g.reason, from: g.from, to: g.to });
  }
  return out;
}

/** The changed paths as one line; never a value. */
export function describeFields(c: TimelineChange): string {
  const paths = (c.fields ?? []).map((f) => f.path);
  if (paths.length === 0) return "";
  let s = paths.join(", ");
  if (c.moreFields) s += ` (+${c.moreFields} more)`;
  if (c.metadataOnly) s += " (metadata only)";
  return s;
}

/** Where a row opens: the object, or an event's involved object. Null when there is nothing to open. */
export function changeObjectHref(c: TimelineChange): string | null {
  if (c.op === "delete") return null;
  if (c.op === "event") {
    if (!c.involvedKind || !c.involvedName) return null;
    return auditObjectHref({ resource: pluralOf(c.involvedKind), namespace: c.namespace, name: c.involvedName });
  }
  return auditObjectHref({ resource: c.resource, namespace: c.namespace, name: c.name });
}

const PLURALS: Record<string, string> = {
  Pod: "pods",
  Deployment: "deployments",
  StatefulSet: "statefulsets",
  DaemonSet: "daemonsets",
  ReplicaSet: "replicasets",
  Job: "jobs",
  CronJob: "cronjobs",
  Service: "services",
  Ingress: "ingresses",
  ConfigMap: "configmaps",
  Node: "nodes",
  PersistentVolumeClaim: "persistentvolumeclaims",
};

function pluralOf(kind: string): string {
  return PLURALS[kind] ?? "";
}

export const RETENTION_CHOICES: { days: number; label: string }[] = [
  { days: 0, label: "Off" },
  { days: 1, label: "1 day" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days (default)" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days (most)" },
];
