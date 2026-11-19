import { statusTone, type StatusTone } from "@kubebay/ui";
import type { CRDEntry } from "./api";

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
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export interface RolloutsDetection {
  installed: boolean;
  rolloutGvr?: string;
  analysisRunGvr?: string;
}

/** Same client-side /api/crds filter as detectKeda: the Rollout CRD, not just any argoproj.io kind (ArgoCD alone has Applications). */
export function detectRollouts(crds: Pick<CRDEntry, "group" | "resource" | "gvr">[]): RolloutsDetection {
  const rollout = crds.find((c) => c.group === "argoproj.io" && c.resource === "rollouts");
  const analysisRun = crds.find((c) => c.group === "argoproj.io" && c.resource === "analysisruns");
  return { installed: !!rollout, rolloutGvr: rollout?.gvr, analysisRunGvr: analysisRun?.gvr };
}

export function rolloutStrategy(ro: Obj): "canary" | "blueGreen" | "unknown" {
  const s = rec(rec(ro.spec).strategy);
  if (s.canary !== undefined) return "canary";
  if (s.blueGreen !== undefined) return "blueGreen";
  return "unknown";
}

function isPaused(ro: Obj): boolean {
  return rec(ro.spec).paused === true || arr(rec(ro.status).pauseConditions).length > 0;
}

/** The controller's own status.phase, with Aborted taking over an aborted rollout (which the controller reports as Degraded). */
export function rolloutPhase(ro: Obj): string {
  const status = rec(ro.status);
  if (status.abort === true) return "Aborted";
  const phase = str(status.phase);
  if (phase) return phase;
  if (isPaused(ro)) return "Paused";
  return "Progressing";
}

/** Status words Rollouts and AnalysisRuns use that statusTone does not know. */
export function rolloutTone(word: string): StatusTone {
  switch (word.trim().toLowerCase()) {
    case "paused":
    case "inconclusive":
      return "warn";
    case "aborted":
      return "err";
    case "successful":
      return "ok";
    default:
      return statusTone(word);
  }
}

/**
 * Canary and stable traffic split. Prefers what the controller reports
 * (status.canary.weights); otherwise the last setWeight among the steps
 * already completed (those before status.currentStepIndex), and 100 once
 * past the last step. null for blue-green, which has no weights.
 */
export function canaryWeights(ro: Obj): { canary: number; stable: number } | null {
  if (rolloutStrategy(ro) !== "canary") return null;
  const status = rec(ro.status);
  const reported = rec(rec(rec(status.canary).weights).canary).weight;
  if (typeof reported === "number") {
    const stable = rec(rec(rec(status.canary).weights).stable).weight;
    return { canary: reported, stable: typeof stable === "number" ? stable : 100 - reported };
  }
  const steps = arr(rec(rec(rec(ro.spec).strategy).canary).steps);
  const idx = num(status.currentStepIndex, 0);
  if (steps.length > 0 && idx >= steps.length) return { canary: 100, stable: 0 };
  let weight = 0;
  for (let i = 0; i < Math.min(idx, steps.length); i++) {
    const w = rec(steps[i]).setWeight;
    if (typeof w === "number") weight = w;
  }
  return { canary: weight, stable: 100 - weight };
}

function ownedBy(o: Obj, rolloutName: string): boolean {
  return arr(rec(o.metadata).ownerReferences).some((r) => str(rec(r).kind) === "Rollout" && str(rec(r).name) === rolloutName);
}

export interface RolloutRevision {
  name: string;
  revision: string;
  images: string[];
}

function revisionOf(rs: Obj): RolloutRevision {
  const meta = rec(rs.metadata);
  const containers = arr(rec(rec(rec(rs.spec).template).spec).containers);
  return {
    name: str(meta.name),
    revision: str(rec(meta.annotations)["rollout.argoproj.io/revision"]),
    images: containers.map((c) => str(rec(c).image)).filter(Boolean),
  };
}

function rsWithHash(sets: Obj[], hash: string): Obj | undefined {
  if (!hash) return undefined;
  return sets.find((s) => str(rec(rec(s.metadata).labels)["rollouts-pod-template-hash"]) === hash);
}

export interface RolloutDescription {
  name: string;
  ns: string;
  strategy: "canary" | "blueGreen" | "unknown";
  phase: string;
  tone: StatusTone;
  message: string;
  /** Current step, 1-based, of the canary's step list. null for blue-green or a canary with no steps. */
  step: { current: number; total: number } | null;
  weights: { canary: number; stable: number } | null;
  replicas: { desired: number; updated: number; ready: number; available: number };
  stable: RolloutRevision | null;
  canary: RolloutRevision | null;
  paused: boolean;
  pauseMessage: string;
  aborted: boolean;
  analysisRuns: { name: string; phase: string; tone: StatusTone }[];
}

export function describeRollout(ro: Obj, replicaSets: Obj[], analysisRuns: Obj[]): RolloutDescription {
  const meta = rec(ro.metadata);
  const spec = rec(ro.spec);
  const status = rec(ro.status);
  const name = str(meta.name);
  const strategy = rolloutStrategy(ro);
  const sets = replicaSets.filter((r) => ownedBy(r, name));

  const steps = arr(rec(rec(spec.strategy).canary).steps);
  const step = strategy === "canary" && steps.length > 0 ? { current: Math.min(num(status.currentStepIndex, 0) + 1, steps.length), total: steps.length } : null;

  const stableHash = str(status.stableRS);
  const currentHash = str(status.currentPodHash);
  const stableRs = rsWithHash(sets, stableHash);
  const canaryRs = currentHash && currentHash !== stableHash ? rsWithHash(sets, currentHash) : undefined;

  const pauseReasons = arr(status.pauseConditions)
    .map((c) => str(rec(c).reason))
    .filter(Boolean);
  const phase = rolloutPhase(ro);
  const phaseWord = phase.toLowerCase();
  const message = str(status.message);
  const paused = isPaused(ro);

  return {
    name,
    ns: str(meta.namespace),
    strategy,
    phase,
    tone: rolloutTone(phase),
    message,
    step,
    weights: canaryWeights(ro),
    replicas: {
      desired: num(spec.replicas, 1),
      updated: num(status.updatedReplicas),
      ready: num(status.readyReplicas),
      available: num(status.availableReplicas),
    },
    stable: stableRs ? revisionOf(stableRs) : null,
    canary: canaryRs ? revisionOf(canaryRs) : null,
    paused,
    pauseMessage: paused ? (phaseWord === "paused" && message ? message : pauseReasons[0] ?? "") : "",
    aborted: status.abort === true,
    analysisRuns: analysisRuns
      .filter((a) => ownedBy(a, name))
      .map((a) => {
        const p = str(rec(a.status).phase) || "Pending";
        return { name: str(rec(a.metadata).name), phase: p, tone: rolloutTone(p) };
      }),
  };
}

export type RolloutAction = "promote" | "promote-full" | "abort" | "retry" | "restart";

export const ROLLOUT_ACTION_LABELS: Record<RolloutAction, string> = {
  promote: "Promote",
  "promote-full": "Promote fully",
  abort: "Abort",
  retry: "Retry",
  restart: "Restart",
};

/** Which actions make sense for the rollout's current state, in display order. */
export function availableRolloutActions(ro: Obj): RolloutAction[] {
  const status = rec(ro.status);
  if (status.abort === true) return ["retry", "restart"];
  const phase = rolloutPhase(ro).toLowerCase();
  if (phase === "healthy") return ["restart"];
  return ["promote", "promote-full", "abort", "restart"];
}

/**
 * The patch each action sends through the existing YAML apply path (JSON
 * merge patch, impersonated and audit-logged). These mirror what the
 * kubectl-argo-rollouts plugin patches: promote clears spec.paused and
 * status.pauseConditions, promote --full sets status.promoteFull, abort sets
 * status.abort, retry clears it, restart sets spec.restartAt. The status
 * fields are patched on the main resource, as the plugin does; the Rollout
 * CRD has no status subresource.
 */
export function rolloutActionRequest(target: { cluster: string; gvr: string; ns: string; name: string }, action: RolloutAction, now: Date = new Date()) {
  let patch: Obj;
  switch (action) {
    case "promote":
      patch = { spec: { paused: false }, status: { pauseConditions: null } };
      break;
    case "promote-full":
      patch = { spec: { paused: false }, status: { pauseConditions: null, promoteFull: true } };
      break;
    case "abort":
      patch = { status: { abort: true } };
      break;
    case "retry":
      patch = { status: { abort: false } };
      break;
    case "restart":
      patch = { spec: { restartAt: now.toISOString() } };
      break;
  }
  const doc = { apiVersion: "argoproj.io/v1alpha1", kind: "Rollout", metadata: { name: target.name, namespace: target.ns }, ...patch };
  return {
    cluster: target.cluster,
    gvr: target.gvr,
    ns: target.ns,
    name: target.name,
    yaml: JSON.stringify(doc),
    dryRun: false,
    force: false,
    mode: "merge" as const,
    action: `rollout-${action}`,
  };
}
