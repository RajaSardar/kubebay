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

/**
 * Whether o is owned by the Rollout ro. Matches the owner reference's UID when
 * both sides carry one (a same-named Rollout in another namespace, or a
 * recreated one, never claims it); otherwise falls back to kind and name, and
 * to the namespace when both objects have one.
 */
export function ownedByRollout(o: Obj, ro: Obj): boolean {
  const rm = rec(ro.metadata);
  const uid = str(rm.uid);
  const ns = str(rm.namespace);
  const ons = str(rec(o.metadata).namespace);
  return arr(rec(o.metadata).ownerReferences).some((r) => {
    if (str(rec(r).kind) !== "Rollout") return false;
    const ruid = str(rec(r).uid);
    if (uid && ruid) return uid === ruid;
    if (ns && ons && ns !== ons) return false;
    return str(rec(r).name) === str(rm.name);
  });
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
  const sets = replicaSets.filter((r) => ownedByRollout(r, ro));

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
      .filter((a) => ownedByRollout(a, ro))
      .map((a) => {
        const p = str(rec(a.status).phase) || "Pending";
        return { name: str(rec(a.metadata).name), phase: p, tone: rolloutTone(p) };
      }),
  };
}

export type RolloutAction = "promote" | "promote-full" | "skip-step" | "pause" | "resume" | "abort" | "retry" | "restart";

export const ROLLOUT_ACTION_LABELS: Record<RolloutAction, string> = {
  promote: "Promote",
  "promote-full": "Promote fully",
  "skip-step": "Skip step",
  pause: "Pause",
  resume: "Resume",
  abort: "Abort",
  retry: "Retry",
  restart: "Restart",
};

function canarySteps(ro: Obj): unknown[] {
  return rolloutStrategy(ro) === "canary" ? arr(rec(rec(rec(ro.spec).strategy).canary).steps) : [];
}

/** Which actions make sense for the rollout's current state, in display order. */
export function availableRolloutActions(ro: Obj): RolloutAction[] {
  const status = rec(ro.status);
  if (status.abort === true) return ["retry", "restart"];
  const phase = rolloutPhase(ro).toLowerCase();
  if (phase === "healthy") return ["restart"];
  const out: RolloutAction[] = ["promote", "promote-full"];
  if (num(status.currentStepIndex, 0) < canarySteps(ro).length) out.push("skip-step");
  out.push(rec(ro.spec).paused === true ? "resume" : "pause", "abort", "restart");
  return out;
}

type RolloutTarget = { cluster: string; gvr: string; ns: string; name: string };

function request(target: RolloutTarget, action: RolloutAction, patch: Obj, subresource?: "status", metadata: Obj = {}) {
  const doc = { apiVersion: "argoproj.io/v1alpha1", kind: "Rollout", metadata: { ...metadata, name: target.name, namespace: target.ns }, ...patch };
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
    ...(subresource ? { subresource } : {}),
  };
}

/**
 * The JSON merge patches each action sends through the existing YAML apply
 * path (impersonated and audit-logged), in order. They mirror what the
 * kubectl-argo-rollouts plugin patches. Since Rollouts v1.0 the CRD has a
 * status subresource, so status fields (pauseConditions, promoteFull,
 * abort, currentStepIndex) go to it (the engine falls back to the main
 * resource where there is none, as the plugin does); spec fields go to the
 * resource itself.
 *   promote: clear status.pauseConditions, then spec.paused=false
 *   promote fully: also status.promoteFull=true
 *   skip step: status.currentStepIndex+1 (promote --skip-current-step),
 *     pinned to the resourceVersion it was read from
 *   pause: spec.paused=true; resume: spec.paused=false only, so it undoes a
 *     Pause without also skipping a step's own pause
 *   abort / retry: status.abort true / false; restart: spec.restartAt
 */
export function rolloutActionRequests(target: RolloutTarget, action: RolloutAction, ro: Obj, now: Date = new Date()) {
  switch (action) {
    case "promote":
      return [request(target, action, { status: { pauseConditions: null } }, "status"), request(target, action, { spec: { paused: false } })];
    case "promote-full":
      return [
        request(target, action, { status: { pauseConditions: null, promoteFull: true } }, "status"),
        request(target, action, { spec: { paused: false } }),
      ];
    case "skip-step": {
      const total = canarySteps(ro).length;
      const next = Math.min(num(rec(ro.status).currentStepIndex, 0) + 1, total);
      const rv = str(rec(ro.metadata).resourceVersion);
      return [request(target, action, { status: { currentStepIndex: next } }, "status", rv ? { resourceVersion: rv } : {})];
    }
    case "pause":
      return [request(target, action, { spec: { paused: true } })];
    case "resume":
      return [request(target, action, { spec: { paused: false } })];
    case "abort":
      return [request(target, action, { status: { abort: true } }, "status")];
    case "retry":
      return [request(target, action, { status: { abort: false } }, "status")];
    case "restart":
      return [request(target, action, { spec: { restartAt: now.toISOString() } })];
  }
}
