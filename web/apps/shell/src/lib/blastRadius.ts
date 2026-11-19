import { matchesSelector, type LabelSelector } from "./labelSelector";

type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return (v ?? {}) as Obj;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
const nameOf = (o: Obj) => str(rec(o.metadata).name);
const nsOf = (o: Obj) => str(rec(o.metadata).namespace);
const labelsOf = (o: Obj) => rec(rec(o.metadata).labels) as Record<string, string>;
const keyOf = (o: Obj) => `${nsOf(o)}/${nameOf(o)}`;

export type BlastAction = "delete" | "scale-zero" | "restart" | "drain" | "cordon";

/** One list of rows per stream. `null` (or missing) means the stream could not be read: its part is "unknown". */
export interface BlastStreams {
  pods?: Obj[] | null;
  replicasets?: Obj[] | null;
  services?: Obj[] | null;
  ingresses?: Obj[] | null;
  httproutes?: Obj[] | null;
  hpas?: Obj[] | null;
  pdbs?: Obj[] | null;
}

export interface BlastItem {
  id: string;
  label: string;
  /** null when the stream behind it is unreadable. */
  count: number | null;
  /** At most five names. */
  examples: string[];
  /** How many more than the examples shown. */
  more: number;
  tone?: "warn";
  note?: string;
}

export interface BlastRadius {
  items: BlastItem[];
  /** Plain context lines that are not a list (for example "running pods stay"). */
  notes: string[];
  /** Advisory warnings, such as a production cluster. */
  warnings: string[];
  /** One line for the collapsed header. */
  summary: string;
}

export interface BlastInput {
  action: BlastAction;
  kind: string;
  obj: Obj;
  streams: BlastStreams;
  /** The cluster looks like production (looksProduction). */
  production?: boolean;
}

const MAX_EXAMPLES = 5;

const NOUNS: Record<string, [string, string]> = {
  replicasets: ["ReplicaSet", "ReplicaSets"],
  pods: ["Pod", "Pods"],
  bare: ["Pod with no controller", "Pods with no controller"],
  services: ["Service losing all endpoints", "Services losing all endpoints"],
  ingresses: ["Ingress reaching them", "Ingresses reaching them"],
  httproutes: ["HTTPRoute reaching them", "HTTPRoutes reaching them"],
  hpas: ["HorizontalPodAutoscaler", "HorizontalPodAutoscalers"],
  pdbs: ["PodDisruptionBudget", "PodDisruptionBudgets"],
  pvcs: ["PersistentVolumeClaim", "PersistentVolumeClaims"],
};

function item(id: string, names: string[] | null, extra: Partial<BlastItem> = {}): BlastItem {
  const n = NOUNS[id]!;
  if (names === null) return { id, label: n[1], count: null, examples: [], more: 0, ...extra };
  const sorted = [...names].sort();
  return {
    id,
    label: names.length === 1 ? n[0] : n[1],
    count: names.length,
    examples: sorted.slice(0, MAX_EXAMPLES),
    more: Math.max(0, sorted.length - MAX_EXAMPLES),
    ...extra,
  };
}

function ownedBy(pod: Obj, kind: string, name: string): boolean {
  return arr(rec(pod.metadata).ownerReferences).some((r) => str(rec(r).kind) === kind && str(rec(r).name) === name);
}

function isDaemonSetPod(pod: Obj): boolean {
  return arr(rec(pod.metadata).ownerReferences).some((r) => str(rec(r).kind) === "DaemonSet");
}

function hasController(pod: Obj): boolean {
  return arr(rec(pod.metadata).ownerReferences).length > 0;
}

function selectorOf(obj: Obj): LabelSelector | null {
  const s = rec(rec(obj.spec).selector);
  return Object.keys(rec(s.matchLabels)).length > 0 || arr(s.matchExpressions).length > 0 ? (s as LabelSelector) : null;
}

/** The pods an action hits, or null when they cannot be known. `rsNames` is null when the ReplicaSet stream is unreadable. */
function affectedPods(input: BlastInput): { pods: Obj[] | null; replicaSets: string[] | null } {
  const { action, kind, obj, streams } = input;
  const pods = streams.pods ?? null;
  const name = nameOf(obj);
  const ns = nsOf(obj);
  if (kind === "Pod") return { pods: [obj], replicaSets: [] };
  if (pods === null) return { pods: null, replicaSets: streams.replicasets ? [] : null };
  if (kind === "Node") {
    if (action === "cordon") return { pods: [], replicaSets: [] };
    let mine = pods.filter((p) => str(rec(p.spec).nodeName) === name);
    if (action === "drain") mine = mine.filter((p) => !isDaemonSetPod(p));
    return { pods: mine, replicaSets: [] };
  }
  const inNs = pods.filter((p) => nsOf(p) === ns);
  if (kind === "Deployment") {
    const rsRows = streams.replicasets ?? null;
    if (rsRows === null) {
      // Fall back to the Deployment's own selector for the pods.
      const sel = selectorOf(obj);
      return { pods: sel ? inNs.filter((p) => matchesSelector(labelsOf(p), sel)) : [], replicaSets: null };
    }
    const rsNames = rsRows.filter((r) => nsOf(r) === ns && ownedBy(r, "Deployment", name)).map(nameOf);
    const set = new Set(rsNames);
    return { pods: inNs.filter((p) => arr(rec(p.metadata).ownerReferences).some((r) => str(rec(r).kind) === "ReplicaSet" && set.has(str(rec(r).name)))), replicaSets: rsNames };
  }
  if (kind === "StatefulSet" || kind === "DaemonSet" || kind === "ReplicaSet" || kind === "Job") {
    return { pods: inNs.filter((p) => ownedBy(p, kind, name)), replicaSets: [] };
  }
  return { pods: [], replicaSets: [] };
}

const MODELLED = new Set(["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "Pod", "Node"]);

/**
 * Blast-radius preview (GAP_PLAN I3): what a delete, scale to zero, restart,
 * drain or cordon touches, computed only from streams the UI already has.
 * Advisory: the API server and the Eviction API stay the enforcers. A part
 * whose stream is unreadable is reported as unknown (count null), never
 * guessed.
 */
export function computeBlastRadius(input: BlastInput): BlastRadius {
  const { action, kind, obj, streams, production } = input;
  const items: BlastItem[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  if (production) warnings.push("This cluster looks like production. Check the target twice before you go on.");

  if (!MODELLED.has(kind)) return { items, notes, warnings, summary: "" };

  if (action === "cordon") notes.push("Running pods stay where they are. No new pods are scheduled on this node.");
  if (action === "restart") notes.push("Pods are replaced one by one, following the rollout strategy.");

  const { pods, replicaSets } = affectedPods(input);
  const podList = pods ?? [];
  const affectedKeys = new Set(podList.map(keyOf));
  const disruptive = action === "delete" || action === "scale-zero" || action === "drain";
  const podsOnlyAction = action !== "cordon";

  if (kind === "Deployment" && action === "delete") items.push(item("replicasets", replicaSets));
  if (podsOnlyAction) items.push(item("pods", pods === null ? null : podList.map(nameOf)));

  if (pods !== null && (action === "drain" || kind === "Pod")) {
    const bare = podList.filter((p) => !hasController(p));
    if (bare.length > 0) {
      items.push(item("bare", bare.map(nameOf), { tone: "warn", note: "Nothing recreates these, so they are gone for good." }));
    }
  }

  // Services that would lose every endpoint, and what routes to them.
  if (disruptive) {
    const svcRows = streams.services ?? null;
    if (pods === null || svcRows === null) {
      items.push(item("services", null));
      items.push(item("ingresses", null));
      items.push(item("httproutes", null));
    } else {
      const allPods = streams.pods ?? [];
      const lost = svcRows.filter((s) => {
        const sel = rec(rec(s.spec).selector) as Record<string, string>;
        if (Object.keys(sel).length === 0) return false;
        const matches = (p: Obj) => nsOf(p) === nsOf(s) && matchesSelector(labelsOf(p), { matchLabels: sel });
        if (!podList.some(matches)) return false;
        return !allPods.some((p) => matches(p) && !affectedKeys.has(keyOf(p)));
      });
      if (lost.length > 0) {
        items.push(item("services", lost.map(nameOf), { tone: "warn", note: "Requests to these Services would fail until pods return." }));
        const lostKeys = new Set(lost.map(keyOf));
        const ing = streams.ingresses ?? null;
        if (ing === null) items.push(item("ingresses", null));
        else {
          const hit = ing.filter((i) => {
            const spec = rec(i.spec);
            const names = [
              str(rec(rec(spec.defaultBackend).service).name),
              ...arr(spec.rules).flatMap((r) => arr(rec(rec(r).http).paths).map((p) => str(rec(rec(rec(p).backend).service).name))),
            ];
            return names.some((n) => n && lostKeys.has(`${nsOf(i)}/${n}`));
          });
          if (hit.length > 0) items.push(item("ingresses", hit.map(nameOf)));
        }
        const routes = streams.httproutes ?? null;
        if (routes === null) items.push(item("httproutes", null));
        else {
          const hit = routes.filter((rt) =>
            arr(rec(rt.spec).rules).some((r) =>
              arr(rec(r).backendRefs).some((b) => {
                const ref = rec(b);
                const k = str(ref.kind);
                if (k && k !== "Service") return false;
                return lostKeys.has(`${str(ref.namespace) || nsOf(rt)}/${str(ref.name)}`);
              }),
            ),
          );
          if (hit.length > 0) items.push(item("httproutes", hit.map(nameOf)));
        }
      }
    }
  }

  // HPAs aimed at the workload.
  if ((kind === "Deployment" || kind === "StatefulSet") && (action === "delete" || action === "scale-zero")) {
    const hpas = streams.hpas ?? null;
    if (hpas === null) items.push(item("hpas", null));
    else {
      const mine = hpas.filter((h) => {
        const t = rec(rec(h.spec).scaleTargetRef);
        return nsOf(h) === nsOf(obj) && str(t.kind) === kind && str(t.name) === nameOf(obj);
      });
      if (mine.length > 0) {
        items.push(
          item("hpas", mine.map(nameOf), {
            note: action === "delete" ? "They would be left pointing at nothing." : "An autoscaler may scale it back up on its own.",
          }),
        );
      }
    }
  }

  // PodDisruptionBudgets covering the affected pods.
  if (podsOnlyAction && (pods === null || podList.length > 0)) {
    const pdbs = streams.pdbs ?? null;
    if (pods === null || pdbs === null) items.push(item("pdbs", null));
    else {
      const covering: { name: string; violated: boolean }[] = [];
      for (const b of pdbs) {
        const sel = rec(rec(b.spec).selector) as LabelSelector;
        const hit = podList.filter((p) => nsOf(p) === nsOf(b) && matchesSelector(labelsOf(p), sel)).length;
        if (hit === 0) continue;
        const allowed = rec(b.status).disruptionsAllowed;
        covering.push({ name: nameOf(b), violated: disruptive && typeof allowed === "number" && hit > allowed });
      }
      if (covering.length > 0) {
        const bad = covering.filter((c) => c.violated);
        items.push(
          item("pdbs", covering.map((c) => c.name), {
            ...(bad.length > 0
              ? {
                  tone: "warn" as const,
                  note:
                    action === "drain"
                      ? `${bad.map((c) => c.name).join(", ")} would block the eviction (not enough disruptions allowed).`
                      : `${bad.map((c) => c.name).join(", ")} would be violated (not enough disruptions allowed).`,
                }
              : {}),
          }),
        );
      }
    }
  }

  // Volumes used by the affected pods.
  if (disruptive && pods !== null) {
    const claims = new Set<string>();
    for (const p of podList) {
      for (const v of arr(rec(p.spec).volumes)) {
        const c = str(rec(rec(v).persistentVolumeClaim).claimName);
        if (c) claims.add(c);
      }
    }
    if (claims.size > 0) {
      items.push(item("pvcs", [...claims], { note: "The claims and their data are kept. Pods that return reattach them." }));
    }
  } else if (disruptive && pods === null) {
    items.push(item("pvcs", null));
  }

  const parts = items.map((i) => (i.count === null ? `${i.label.toLowerCase()} unknown` : `${i.count} ${i.label.toLowerCase()}`));
  return { items, notes, warnings, summary: parts.join(", ") };
}
