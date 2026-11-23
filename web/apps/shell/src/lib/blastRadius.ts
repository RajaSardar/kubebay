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

export type BlastAction = "delete" | "scale-zero" | "scale-down" | "restart" | "drain" | "cordon";

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
  /** For "scale-down": the replica count being set (below spec.replicas, above zero). */
  toReplicas?: number;
}

export interface BulkBlastInput extends Omit<BlastInput, "obj"> {
  /** Every selected object, all of `kind`. */
  objs: Obj[];
}

const MAX_EXAMPLES = 5;

const NOUNS: Record<string, [string, string]> = {
  replicasets: ["ReplicaSet", "ReplicaSets"],
  pods: ["Pod", "Pods"],
  bare: ["Pod with no controller", "Pods with no controller"],
  services: ["Service losing all endpoints", "Services losing all endpoints"],
  "svc-fewer": ["Service with fewer ready endpoints", "Services with fewer ready endpoints"],
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

/** Objects with the same namespace and name, once. */
function uniq(objs: Obj[]): Obj[] {
  const seen = new Map<string, Obj>();
  for (const o of objs) if (!seen.has(keyOf(o))) seen.set(keyOf(o), o);
  return [...seen.values()];
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

function isReady(pod: Obj): boolean {
  return arr(rec(pod.status).conditions).some((c) => str(rec(c).type) === "Ready" && str(rec(c).status) === "True");
}

function isTerminating(pod: Obj): boolean {
  return !!rec(pod.metadata).deletionTimestamp;
}

function selectorOf(obj: Obj): LabelSelector | null {
  const s = rec(rec(obj.spec).selector);
  return Object.keys(rec(s.matchLabels)).length > 0 || arr(s.matchExpressions).length > 0 ? (s as LabelSelector) : null;
}

/** The pods an action hits on one object, or null when they cannot be known. `replicaSets` is null when the ReplicaSet stream is unreadable. */
function affectedPods(action: BlastAction, kind: string, obj: Obj, streams: BlastStreams): { pods: Obj[] | null; replicaSets: Obj[] | null } {
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
      // Fall back to the Deployment's own selector for the pods; without one they are unknown.
      const sel = selectorOf(obj);
      return { pods: sel ? inNs.filter((p) => matchesSelector(labelsOf(p), sel)) : null, replicaSets: null };
    }
    const mineRs = rsRows.filter((r) => nsOf(r) === ns && ownedBy(r, "Deployment", name));
    const set = new Set(mineRs.map(nameOf));
    return { pods: inNs.filter((p) => arr(rec(p.metadata).ownerReferences).some((r) => str(rec(r).kind) === "ReplicaSet" && set.has(str(rec(r).name)))), replicaSets: mineRs };
  }
  if (kind === "StatefulSet" || kind === "DaemonSet" || kind === "ReplicaSet" || kind === "Job") {
    return { pods: inNs.filter((p) => ownedBy(p, kind, name)), replicaSets: [] };
  }
  return { pods: [], replicaSets: [] };
}

function ordinal(pod: Obj): number {
  const m = /-(\d+)$/.exec(nameOf(pod));
  return m ? Number(m[1]) : -1;
}

/**
 * The pods a scale-down to `to` removes. A StatefulSet removes its highest
 * ordinals; a ReplicaSet-backed workload ranks unscheduled, then not-ready,
 * then newer pods first (the controller's order, approximately).
 */
function scaleDownVictims(kind: string, pods: Obj[], to: number): Obj[] {
  const live = pods.filter((p) => !isTerminating(p));
  const n = live.length - to;
  if (n <= 0) return [];
  if (kind === "StatefulSet") return [...live].sort((a, b) => ordinal(b) - ordinal(a)).slice(0, n);
  const rank = (p: Obj) => (!str(rec(p.spec).nodeName) ? 0 : !isReady(p) ? 1 : 2);
  const created = (p: Obj) => str(rec(p.metadata).creationTimestamp);
  return [...live].sort((a, b) => rank(a) - rank(b) || created(b).localeCompare(created(a))).slice(0, n);
}

const MODELLED = new Set(["Deployment", "StatefulSet", "DaemonSet", "ReplicaSet", "Job", "Pod", "Node"]);

/**
 * Blast-radius preview (GAP_PLAN I3): what a delete, scale to zero, scale
 * down, restart, drain or cordon touches, computed only from streams the UI
 * already has. Advisory: the API server and the Eviction API stay the
 * enforcers. A part whose stream is unreadable is reported as unknown (count
 * null), never guessed.
 */
export function computeBlastRadius(input: BlastInput): BlastRadius {
  const { obj, ...rest } = input;
  return compute({ ...rest, objs: [obj] });
}

/**
 * The same preview for a multi-select action (bulk delete): one aggregate
 * across every selected object. Pods, Services and budgets are judged against
 * the whole selection, so two Deployments that together back a Service show
 * it losing all endpoints even though neither would alone.
 */
export function computeBulkBlastRadius(input: BulkBlastInput): BlastRadius {
  return compute(input);
}

function compute(input: BulkBlastInput): BlastRadius {
  const { action, kind, streams, production, toReplicas } = input;
  const objs = uniq(input.objs);
  const items: BlastItem[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  if (production) warnings.push("This cluster looks like production. Check the target twice before you go on.");

  if (!MODELLED.has(kind) || objs.length === 0) return { items, notes, warnings, summary: "" };

  const scaleDown = action === "scale-down";
  if (scaleDown) {
    const from = rec(objs[0]!.spec).replicas;
    if (toReplicas === undefined || toReplicas <= 0 || (typeof from === "number" && toReplicas >= from)) {
      return { items, notes, warnings, summary: "" };
    }
  }

  // Names carry their namespace when the selection spans more than one.
  const multiNs = new Set(objs.map(nsOf)).size > 1;
  const disp = (o: Obj) => (multiNs && nsOf(o) ? `${nsOf(o)}/${nameOf(o)}` : nameOf(o));
  const names = (list: Obj[]) => uniq(list).map(disp);

  if (objs.length > 1) notes.push(`${objs.length} selected. The counts are the total across all of them.`);
  if (action === "cordon") notes.push("Running pods stay where they are. No new pods are scheduled on this node.");
  if (action === "restart") notes.push("Pods are replaced one by one, following the rollout strategy.");

  let pods: Obj[] | null = [];
  let replicaSets: Obj[] | null = [];
  for (const o of objs) {
    const r = affectedPods(action, kind, o, streams);
    let mine = r.pods;
    if (scaleDown && mine !== null) mine = scaleDownVictims(kind, mine, toReplicas!);
    pods = pods === null || mine === null ? null : [...pods, ...mine];
    replicaSets = replicaSets === null || r.replicaSets === null ? null : [...replicaSets, ...r.replicaSets];
  }
  if (pods !== null) pods = uniq(pods);
  const podList = pods ?? [];
  const affectedKeys = new Set(podList.map(keyOf));
  const disruptive = action === "delete" || action === "scale-zero" || action === "scale-down" || action === "drain";
  const podsOnlyAction = action !== "cordon";

  if (kind === "Deployment" && action === "delete") items.push(item("replicasets", replicaSets === null ? null : names(replicaSets)));
  if (podsOnlyAction) {
    const podNote = !scaleDown
      ? {}
      : kind === "StatefulSet"
        ? { note: "A StatefulSet removes its highest ordinals first." }
        : { note: "The controller picks which pods go: unscheduled and not-ready pods first, then the newest." };
    items.push(item("pods", pods === null ? null : names(podList), podNote));
  }

  if (pods !== null && (action === "drain" || kind === "Pod")) {
    const bare = podList.filter((p) => !hasController(p));
    if (bare.length > 0) {
      items.push(item("bare", names(bare), { tone: "warn", note: "Nothing recreates these, so they are gone for good." }));
    }
  }

  // Services that would lose every endpoint (or, on a scale-down, some), and what routes to them.
  if (disruptive) {
    const svcRows = streams.services ?? null;
    if (pods === null || svcRows === null) {
      items.push(item("services", null));
      items.push(item("ingresses", null));
      items.push(item("httproutes", null));
    } else {
      const allPods = streams.pods ?? [];
      const lost: Obj[] = [];
      const fewer: string[] = [];
      for (const s of svcRows) {
        const sel = rec(rec(s.spec).selector) as Record<string, string>;
        if (Object.keys(sel).length === 0) continue;
        const matches = (p: Obj) => nsOf(p) === nsOf(s) && matchesSelector(labelsOf(p), { matchLabels: sel });
        if (!podList.some(matches)) continue;
        if (scaleDown) {
          const backing = allPods.filter((p) => matches(p) && isReady(p));
          const before = backing.length;
          const after = backing.filter((p) => !affectedKeys.has(keyOf(p))).length;
          if (before > 0 && after === 0) lost.push(s);
          else if (after < before) fewer.push(`${disp(s)} (${before} → ${after} ready)`);
        } else if (!allPods.some((p) => matches(p) && !affectedKeys.has(keyOf(p)))) {
          lost.push(s);
        }
      }
      if (fewer.length > 0) items.push(item("svc-fewer", fewer, { note: "They keep serving, with less capacity." }));
      if (lost.length > 0) {
        items.push(item("services", names(lost), { tone: "warn", note: "Requests to these Services would fail until pods return." }));
        const lostKeys = new Set(lost.map(keyOf));
        const ing = streams.ingresses ?? null;
        if (ing === null) items.push(item("ingresses", null));
        else {
          const hit = ing.filter((i) => {
            const spec = rec(i.spec);
            const backends = [
              str(rec(rec(spec.defaultBackend).service).name),
              ...arr(spec.rules).flatMap((r) => arr(rec(rec(r).http).paths).map((p) => str(rec(rec(rec(p).backend).service).name))),
            ];
            return backends.some((n) => n && lostKeys.has(`${nsOf(i)}/${n}`));
          });
          if (hit.length > 0) items.push(item("ingresses", names(hit)));
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
          if (hit.length > 0) items.push(item("httproutes", names(hit)));
        }
      }
    }
  }

  // HPAs aimed at the workload(s).
  if ((kind === "Deployment" || kind === "StatefulSet") && (action === "delete" || action === "scale-zero" || scaleDown)) {
    const hpas = streams.hpas ?? null;
    if (hpas === null) items.push(item("hpas", null));
    else {
      const targets = new Set(objs.map(keyOf));
      const mine = hpas.filter((h) => {
        const t = rec(rec(h.spec).scaleTargetRef);
        return str(t.kind) === kind && targets.has(`${nsOf(h)}/${str(t.name)}`);
      });
      if (mine.length > 0) {
        let extra: Partial<BlastItem>;
        if (scaleDown) {
          const floor = Math.max(...mine.map((h) => (typeof rec(h.spec).minReplicas === "number" ? (rec(h.spec).minReplicas as number) : 1)));
          extra = {
            tone: "warn",
            note:
              floor > toReplicas!
                ? `Its minReplicas ${floor} is above ${toReplicas}, so it will scale back up to at least ${floor}.`
                : "An autoscaler sets the replica count and may undo this change.",
          };
        } else {
          extra = { note: action === "delete" ? "They would be left pointing at nothing." : "An autoscaler may scale it back up on its own." };
        }
        items.push(item("hpas", names(mine), extra));
      }
    }
  }

  // PodDisruptionBudgets covering the affected pods.
  if (podsOnlyAction && (pods === null || podList.length > 0)) {
    const pdbs = streams.pdbs ?? null;
    if (pods === null || pdbs === null) items.push(item("pdbs", null));
    else {
      const covering: { obj: Obj; problem: string }[] = [];
      for (const b of pdbs) {
        const sel = rec(rec(b.spec).selector) as LabelSelector;
        const covers = (p: Obj) => nsOf(p) === nsOf(b) && matchesSelector(labelsOf(p), sel);
        const hit = podList.filter(covers).length;
        if (hit === 0) continue;
        let problem = "";
        if (scaleDown) {
          // A budget never blocks a scale-down, but the count can leave it short.
          const min = rec(b.spec).minAvailable;
          const healthyAfter = (streams.pods ?? []).filter((p) => covers(p) && isReady(p) && !isTerminating(p) && !affectedKeys.has(keyOf(p))).length;
          if (typeof min === "number" && healthyAfter < min) problem = `${nameOf(b)} (${healthyAfter} healthy left, needs ${min})`;
        } else if (disruptive) {
          const allowed = rec(b.status).disruptionsAllowed;
          if (typeof allowed === "number" && hit > allowed) problem = nameOf(b);
        }
        covering.push({ obj: b, problem });
      }
      if (covering.length > 0) {
        const bad = covering.filter((c) => c.problem).map((c) => c.problem);
        let extra: Partial<BlastItem> = {};
        if (bad.length > 0) {
          const list = bad.join(", ");
          extra = {
            tone: "warn",
            note:
              action === "drain"
                ? `${list} would block the eviction (not enough disruptions allowed).`
                : scaleDown
                  ? `${list} would drop below its minAvailable. A budget does not block a scale-down.`
                  : `${list} would be violated (not enough disruptions allowed).`,
          };
        } else if (scaleDown) {
          extra = { note: "Their minAvailable still holds after the change." };
        }
        items.push(item("pdbs", names(covering.map((c) => c.obj)), extra));
      }
    }
  }

  // Volumes used by the affected pods.
  if (disruptive && pods !== null) {
    const claims = new Set<string>();
    for (const p of podList) {
      for (const v of arr(rec(p.spec).volumes)) {
        const c = str(rec(rec(v).persistentVolumeClaim).claimName);
        if (c) claims.add(multiNs && nsOf(p) ? `${nsOf(p)}/${c}` : c);
      }
    }
    if (claims.size > 0) {
      const deletedOnScale =
        scaleDown && objs.some((o) => str(rec(rec(o.spec).persistentVolumeClaimRetentionPolicy).whenScaled) === "Delete");
      items.push(
        item("pvcs", [...claims], {
          note: deletedOnScale
            ? "The StatefulSet's whenScaled policy is Delete, so these claims and their data are deleted."
            : "The claims and their data are kept. Pods that return reattach them.",
          ...(deletedOnScale ? { tone: "warn" as const } : {}),
        }),
      );
    }
  } else if (disruptive && pods === null) {
    items.push(item("pvcs", null));
  }

  const parts = items.map((i) => (i.count === null ? `${i.label.toLowerCase()} unknown` : `${i.count} ${i.label.toLowerCase()}`));
  return { items, notes, warnings, summary: parts.join(", ") };
}
