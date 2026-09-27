import { ownerOf, type GitOpsOwner } from "./gitops";
import type { WorkloadWaste } from "./api";

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" ? v : fallback;
}

const MEM_SUFFIXES: [string, number][] = [
  ["Ki", 1024],
  ["Mi", 1024 ** 2],
  ["Gi", 1024 ** 3],
  ["Ti", 1024 ** 4],
  ["Pi", 1024 ** 5],
  ["Ei", 1024 ** 6],
  ["K", 1000],
  ["M", 1000 ** 2],
  ["G", 1000 ** 3],
  ["T", 1000 ** 4],
  ["P", 1000 ** 5],
  ["E", 1000 ** 6],
];

/** Parses a Kubernetes CPU quantity ("250m", "1", "0.5") into millicores. */
export function parseCpuMillis(v: string | undefined): number {
  if (!v) return 0;
  if (v.endsWith("m")) {
    const n = parseFloat(v.slice(0, -1));
    return Number.isFinite(n) ? n : 0;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n * 1000 : 0;
}

/** Parses a Kubernetes memory quantity ("128Mi", "1Gi", "1024") into bytes. */
export function parseMemBytes(v: string | undefined): number {
  if (!v) return 0;
  for (const [suffix, mult] of MEM_SUFFIXES) {
    if (v.endsWith(suffix)) {
      const n = parseFloat(v.slice(0, -suffix.length));
      return Number.isFinite(n) ? n * mult : 0;
    }
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** Formats millicores back into the conventional "250m" / "1.00" core display. */
export function formatCpuMillis(millis: number): string {
  if (millis < 1000) return `${Math.round(millis)}m`;
  return (millis / 1000).toFixed(2);
}

/** Formats bytes back into the largest binary unit that stays >= 1. */
export function formatMemBytes(bytes: number): string {
  const units: [string, number][] = [...MEM_SUFFIXES.filter(([s]) => s.endsWith("i"))].reverse();
  for (const [suffix, mult] of units) {
    if (bytes >= mult) {
      const n = bytes / mult;
      return `${Number.isInteger(n) ? n : n.toFixed(2)}${suffix}`;
    }
  }
  return `${Math.round(bytes)}`;
}

const SUPPORTED_KINDS = new Set(["Deployment", "StatefulSet", "DaemonSet"]);

// Materiality gate: a dimension only counts as actionable waste once it clears
// BOTH a relative floor (so tiny workloads with naturally noisy recommendations
// don't dominate the list) and an absolute floor (so a 90% relative delta on a
// 10m container doesn't rank above real waste) — per the backlog's explicit
// "≥20% delta AND ≥50m CPU/64Mi memory absolute" requirement.
const CPU_ABS_THRESHOLD_MILLIS = 50;
const MEM_ABS_THRESHOLD_BYTES = 64 * 1024 * 1024;
const RELATIVE_THRESHOLD = 0.2;

export function isMaterial(current: number, target: number, absThreshold: number): boolean {
  const delta = Math.abs(current - target);
  if (delta < absThreshold) return false;
  if (current === 0) return delta >= absThreshold;
  return delta / current >= RELATIVE_THRESHOLD;
}

export interface RightSizingRow {
  ns: string;
  workloadKind: string;
  workloadName: string;
  container: string;
  replicas: number;
  vpaName: string;
  vpaUpdateMode: string;
  currentCpuMillis: number;
  currentMemBytes: number;
  targetCpuMillis: number;
  targetMemBytes: number;
  wastedCpuMillis: number;
  wastedMemBytes: number;
  cpuMaterial: boolean;
  memMaterial: boolean;
  material: boolean;
  hpaCpuConflict: boolean;
  gitopsOwner: GitOpsOwner | null;
  /** Which recommender produced this row — surfaced so the UI never implies
   * more authority than the source actually has (a tuned VPA vs. Kubebay's
   * own raw 3h p95). */
  source: "vpa" | "metrics-server";
  /** Only set for source: "metrics-server" — e.g. "observed over 3h, 180 samples". */
  window?: string;
}

interface ContainerRecommendation {
  containerName: string;
  target: { cpu?: string; memory?: string };
}

function containerRecommendations(vpa: Record<string, unknown>): ContainerRecommendation[] {
  const list = rec(rec(vpa.status).recommendation)["containerRecommendations"];
  if (!Array.isArray(list)) return [];
  return list.map((c) => {
    const cr = rec(c);
    const target = rec(cr.target);
    return {
      containerName: str(cr.containerName),
      target: { cpu: str(target.cpu) || undefined, memory: str(target.memory) || undefined },
    };
  });
}

function workloadContainers(workload: Record<string, unknown>): { name: string; requests: { cpu?: string; memory?: string } }[] {
  const containers = rec(rec(rec(workload.spec).template).spec).containers;
  if (!Array.isArray(containers)) return [];
  return containers.map((c) => {
    const cc = rec(c);
    const requests = rec(rec(cc.resources).requests);
    return {
      name: str(cc.name),
      requests: { cpu: str(requests.cpu) || undefined, memory: str(requests.memory) || undefined },
    };
  });
}

// An HPA "targets CPU" if it carries a v2 Resource metric for cpu (the only
// shape the autoscaling/v2 GVR this feature streams can have).
export function hpaTargetsCpu(hpa: Record<string, unknown>): boolean {
  const metrics = rec(hpa.spec).metrics;
  if (!Array.isArray(metrics)) return false;
  return metrics.some((m) => {
    const mm = rec(m);
    return str(mm.type) === "Resource" && str(rec(mm.resource).name) === "cpu";
  });
}

export function sameTarget(refA: { kind: string; name: string }, ns: string, hpa: Record<string, unknown>, hpaNs: string): boolean {
  if (ns !== hpaNs) return false;
  const ref = rec(hpa.spec).scaleTargetRef;
  const r = rec(ref);
  return str(r.kind) === refA.kind && str(r.name) === refA.name;
}

/**
 * Builds one ranked row per (workload, container) that has both a VPA
 * recommendation and a live workload to compare it against — VPA-only for
 * v1 (see innovation backlog #4). Jobs/CronJobs are out of scope; rows that
 * don't clear the materiality gate on either dimension are dropped entirely
 * rather than shown as noise.
 */
export function computeRightSizingRows(input: {
  vpas: Record<string, unknown>[];
  workloads: Record<string, unknown>[];
  hpas: Record<string, unknown>[];
}): RightSizingRow[] {
  const rows: RightSizingRow[] = [];

  for (const vpa of input.vpas) {
    const meta = rec(vpa.metadata);
    const ns = str(meta.namespace);
    const targetRef = rec(rec(vpa.spec).targetRef);
    const kind = str(targetRef.kind);
    const name = str(targetRef.name);
    if (!SUPPORTED_KINDS.has(kind)) continue;

    const workload = input.workloads.find((w) => {
      const wm = rec(w.metadata);
      return str(wm.namespace) === ns && str(wm.name) === name;
    });
    if (!workload) continue;

    const replicas = num(rec(workload.spec).replicas, 1) || 1;
    const containers = workloadContainers(workload);
    const recs = containerRecommendations(vpa);
    const updateMode = str(rec(rec(vpa.spec).updatePolicy).updateMode) || "Off";

    const hpaCpuConflict = input.hpas.some(
      (h) => hpaTargetsCpu(h) && sameTarget({ kind, name }, ns, h, str(rec(h.metadata).namespace)),
    );

    for (const cr of recs) {
      const container = containers.find((c) => c.name === cr.containerName);
      if (!container) continue;

      const currentCpuMillis = parseCpuMillis(container.requests.cpu);
      const currentMemBytes = parseMemBytes(container.requests.memory);
      const targetCpuMillis = parseCpuMillis(cr.target.cpu);
      const targetMemBytes = parseMemBytes(cr.target.memory);

      const cpuMaterial = isMaterial(currentCpuMillis, targetCpuMillis, CPU_ABS_THRESHOLD_MILLIS);
      const memMaterial = isMaterial(currentMemBytes, targetMemBytes, MEM_ABS_THRESHOLD_BYTES);
      if (!cpuMaterial && !memMaterial) continue;

      rows.push({
        ns,
        workloadKind: kind,
        workloadName: name,
        container: cr.containerName,
        replicas,
        vpaName: str(meta.name),
        vpaUpdateMode: updateMode,
        currentCpuMillis,
        currentMemBytes,
        targetCpuMillis,
        targetMemBytes,
        wastedCpuMillis: Math.max(currentCpuMillis - targetCpuMillis, 0) * replicas,
        wastedMemBytes: Math.max(currentMemBytes - targetMemBytes, 0) * replicas,
        cpuMaterial,
        memMaterial,
        material: cpuMaterial || memMaterial,
        hpaCpuConflict,
        gitopsOwner: ownerOf(workload),
        source: "vpa",
      });
    }
  }

  return rows.sort((a, b) => wasteScore(b) - wasteScore(a));
}

/**
 * Workload-level rows from Kubebay's own metrics-server-based recommender
 * (backlog #4 v2) — the "most clusters have no VPA" case. Coarser than a
 * VPA row (no per-container breakdown, since the engine aggregates usage to
 * the whole workload), so `container` is a synthetic label rather than a
 * real container name. Same materiality gate and HPA-conflict detection as
 * the VPA path, for a consistent bar across both sources.
 */
export function computeEngineRightSizingRows(waste: WorkloadWaste[], hpas: Record<string, unknown>[]): RightSizingRow[] {
  const rows: RightSizingRow[] = [];

  for (const w of waste) {
    if (!SUPPORTED_KINDS.has(w.kind)) continue;

    const cpuMaterial = isMaterial(w.requestedCpuMillis, w.p95CpuMillis, CPU_ABS_THRESHOLD_MILLIS);
    const memMaterial = isMaterial(w.requestedMemBytes, w.p95MemBytes, MEM_ABS_THRESHOLD_BYTES);
    if (!cpuMaterial && !memMaterial) continue;

    const hpaCpuConflict = hpas.some(
      (h) => hpaTargetsCpu(h) && sameTarget({ kind: w.kind, name: w.name }, w.ns, h, str(rec(h.metadata).namespace)),
    );

    rows.push({
      ns: w.ns,
      workloadKind: w.kind,
      workloadName: w.name,
      container: "(all containers)",
      replicas: w.podCount || 1,
      vpaName: "",
      vpaUpdateMode: "",
      currentCpuMillis: w.requestedCpuMillis,
      currentMemBytes: w.requestedMemBytes,
      targetCpuMillis: w.p95CpuMillis,
      targetMemBytes: w.p95MemBytes,
      wastedCpuMillis: Math.max(w.requestedCpuMillis - w.p95CpuMillis, 0),
      wastedMemBytes: Math.max(w.requestedMemBytes - w.p95MemBytes, 0),
      cpuMaterial,
      memMaterial,
      material: cpuMaterial || memMaterial,
      hpaCpuConflict,
      gitopsOwner: null,
      source: "metrics-server",
      window: w.window,
    });
  }

  return rows.sort((a, b) => wasteScore(b) - wasteScore(a));
}

/**
 * Combines VPA-sourced and engine-sourced rows into one ranked list. A VPA
 * recommendation wins over the engine's own for the same workload — it's a
 * purpose-built controller, ours is a raw 3h p95 — so an engine row is
 * dropped whenever any VPA row already covers that workload.
 */
export function mergeRightSizingRows(vpaRows: RightSizingRow[], engineRows: RightSizingRow[]): RightSizingRow[] {
  const vpaCovered = new Set(vpaRows.map((r) => `${r.ns}/${r.workloadKind}/${r.workloadName}`));
  const keptEngineRows = engineRows.filter((r) => !vpaCovered.has(`${r.ns}/${r.workloadKind}/${r.workloadName}`));
  return [...vpaRows, ...keptEngineRows].sort((a, b) => wasteScore(b) - wasteScore(a));
}

function wasteScore(r: RightSizingRow): number {
  return r.wastedCpuMillis / 1000 + r.wastedMemBytes / 1024 ** 3;
}

const KIND_TO_GVR: Record<string, string> = {
  Deployment: "apps/v1/deployments",
  StatefulSet: "apps/v1/statefulsets",
  DaemonSet: "apps/v1/daemonsets",
};

/** GVR string (as `applyYaml`/`resolveGVR` expect it) for a supported workload kind. */
export function gvrForWorkloadKind(kind: string): string {
  return KIND_TO_GVR[kind] ?? "";
}

export interface ContainerPatch {
  name: string;
  cpu?: string;
  memory?: string;
}

/**
 * Builds the minimal Server-Side-Apply document for a right-sizing patch:
 * only `spec.template.spec.containers[].resources.requests` for the named
 * containers — never `limits`, and never a container/field the caller
 * didn't ask for (e.g. cpu is omitted entirely when an HPA-on-CPU conflict
 * means only memory should move). Hand-built rather than run through a
 * generic YAML serializer since the shape here is small and fixed, and
 * every value is a K8s-safe scalar (namespace/name/container name, or a
 * resource quantity like "250m") that never needs escaping beyond quotes.
 */
export function buildResizePatchYaml(target: { kind: string; ns: string; name: string }, patches: ContainerPatch[]): string {
  const lines = [
    `apiVersion: apps/v1`,
    `kind: ${target.kind}`,
    `metadata:`,
    `  name: ${target.name}`,
    `  namespace: ${target.ns}`,
    `spec:`,
    `  template:`,
    `    spec:`,
    `      containers:`,
  ];
  for (const p of patches) {
    lines.push(`        - name: ${p.name}`);
    lines.push(`          resources:`);
    lines.push(`            requests:`);
    if (p.cpu) lines.push(`              cpu: "${p.cpu}"`);
    if (p.memory) lines.push(`              memory: "${p.memory}"`);
  }
  return lines.join("\n") + "\n";
}
