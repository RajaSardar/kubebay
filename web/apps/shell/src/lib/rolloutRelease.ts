import type { StatusTone } from "@kubebay/ui";
import {
  arr,
  availableRolloutActions,
  num,
  ownedByRollout,
  rec,
  rolloutPhase,
  rolloutStrategy,
  rolloutTone,
  str,
  type RolloutAction,
} from "./rollouts";

type Obj = Record<string, unknown>;

/** Longest status text the view keeps. Controllers and metric providers write these fields, so they are untrusted. */
export const MAX_TEXT = 200;
const HASH = "rollouts-pod-template-hash";

function text(v: unknown): string {
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  return s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s;
}

export type StepState = "done" | "current" | "pending";
export interface ReleaseStep {
  index: number;
  kind: string;
  label: string;
  state: StepState;
  paused: boolean;
  pauseReason?: string;
  note?: string;
}
export interface ReleaseReplicaSet {
  name: string;
  revision: string;
  images: string[];
  role: "stable" | "canary" | "active" | "preview" | "previous";
  ready: number;
  desired: number;
  weight: number | null;
  /** "live" when the controller reports the traffic split, "target" when it is only the step's setWeight. */
  weightKind: "live" | "target" | null;
}
export interface ReleaseService {
  role: "active" | "preview" | "stable" | "canary";
  name: string;
  /** null when Services could not be read, so presence is unknown. */
  found: boolean | null;
  selectsRevision?: string;
}
export interface ReleaseMetric {
  name: string;
  phase: string;
  tone: StatusTone;
  summary: string;
  lastValue?: string;
  failure?: string;
}
export interface ReleaseAnalysis {
  name: string;
  phase: string;
  tone: StatusTone;
  message: string;
  metrics: ReleaseMetric[];
}
export interface ReleaseCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  tone: StatusTone;
}
export interface ReleaseView {
  strategy: "canary" | "blueGreen" | "unknown";
  phase: string;
  tone: StatusTone;
  message: string;
  steps: ReleaseStep[];
  replicaSets: ReleaseReplicaSet[];
  services: ReleaseService[];
  servicesAvailable: boolean;
  analyses: ReleaseAnalysis[];
  conditions: ReleaseCondition[];
  haltReason: string | null;
  actions: RolloutAction[];
}

function stepOf(raw: unknown, index: number): Pick<ReleaseStep, "index" | "kind" | "label"> {
  const s = rec(raw);
  if (typeof s.setWeight === "number") return { index, kind: "setWeight", label: `Set weight ${s.setWeight}%` };
  if (s.pause !== undefined) {
    const d = text(rec(s.pause).duration);
    return { index, kind: "pause", label: d ? `Pause ${d}` : "Pause" };
  }
  if (s.analysis !== undefined) return { index, kind: "analysis", label: "Analysis" };
  if (s.setCanaryScale !== undefined) return { index, kind: "setCanaryScale", label: "Set canary scale" };
  if (s.experiment !== undefined) return { index, kind: "experiment", label: "Experiment" };
  if (s.setHeaderRoute !== undefined) return { index, kind: "setHeaderRoute", label: "Set header route" };
  if (s.setMirrorRoute !== undefined) return { index, kind: "setMirrorRoute", label: "Set mirror route" };
  return { index, kind: "other", label: "Step" };
}

function buildSteps(ro: Obj): ReleaseStep[] {
  if (rolloutStrategy(ro) !== "canary") return [];
  const status = rec(ro.status);
  const raw = arr(rec(rec(rec(ro.spec).strategy).canary).steps);
  const idx = num(status.currentStepIndex, 0);
  const aborted = status.abort === true;
  const pauses = arr(status.pauseConditions);
  const pauseReason = text(rec(pauses[0]).reason);
  return raw.map((r, i) => {
    const base = stepOf(r, i);
    const state: StepState = i < idx ? "done" : i === idx ? "current" : "pending";
    const step: ReleaseStep = { ...base, state, paused: false };
    if (state === "current" && base.kind === "pause" && pauses.length > 0) {
      step.paused = true;
      if (pauseReason) step.pauseReason = pauseReason;
    }
    if (state === "current" && aborted) step.note = "aborted";
    return step;
  });
}

function revisionNum(rs: ReleaseReplicaSet): number {
  const n = Number(rs.revision);
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function buildReplicaSets(ro: Obj, sets: Obj[]): ReleaseReplicaSet[] {
  const status = rec(ro.status);
  const strategy = rolloutStrategy(ro);
  const stable = str(status.stableRS);
  const current = str(status.currentPodHash);
  const bg = rec(status.blueGreen);
  const active = str(bg.activeSelector);
  const preview = str(bg.previewSelector);

  // Traffic split: what the controller reports is live; otherwise the step's setWeight is only a target.
  let canaryWeight: number | null = null;
  let kind: "live" | "target" | null = null;
  if (strategy === "canary") {
    const w = rec(rec(rec(status.canary).weights).canary).weight;
    if (typeof w === "number") {
      canaryWeight = w;
      kind = "live";
    } else {
      const steps = arr(rec(rec(rec(ro.spec).strategy).canary).steps);
      const idx = num(status.currentStepIndex, 0);
      // Fully promoted (stable is the current template) or aborted: traffic is on stable.
      if (status.abort === true || (stable && stable === current)) canaryWeight = 0;
      else if (steps.length > 0 && idx >= steps.length) canaryWeight = 100;
      else {
        canaryWeight = 0;
        for (let i = 0; i <= Math.min(idx, steps.length - 1); i++) {
          const sw = rec(steps[i]).setWeight;
          if (typeof sw === "number") canaryWeight = sw;
        }
      }
      kind = "target";
    }
  }

  const out = sets
    .filter((s) => ownedByRollout(s, ro))
    .map((s): ReleaseReplicaSet => {
      const meta = rec(s.metadata);
      const hash = str(rec(meta.labels)[HASH]);
      let role: ReleaseReplicaSet["role"] = "previous";
      if (strategy === "blueGreen") {
        if (hash && hash === active) role = "active";
        else if (hash && hash === preview) role = "preview";
      } else if (hash && hash === stable) role = "stable";
      else if (hash && hash === current) role = "canary";
      let weight: number | null = null;
      if (canaryWeight !== null && role === "canary") weight = canaryWeight;
      else if (canaryWeight !== null && role === "stable") weight = 100 - canaryWeight;
      return {
        name: str(meta.name),
        revision: text(rec(meta.annotations)["rollout.argoproj.io/revision"]),
        images: arr(rec(rec(rec(s.spec).template).spec).containers).map((c) => text(rec(c).image)).filter(Boolean),
        role,
        ready: num(rec(s.status).readyReplicas),
        desired: num(rec(s.spec).replicas),
        weight,
        weightKind: weight === null ? null : kind,
      };
    });
  const order = { stable: 0, active: 0, canary: 1, preview: 1, previous: 2 } as const;
  return out.sort((a, b) => order[a.role] - order[b.role] || revisionNum(b) - revisionNum(a));
}

function buildServices(ro: Obj, sets: ReleaseReplicaSet[], rawSets: Obj[], services: Obj[] | null): ReleaseService[] {
  const strategy = rolloutStrategy(ro);
  const s = rec(rec(rec(ro.spec).strategy)[strategy === "canary" ? "canary" : "blueGreen"]);
  const wanted: { role: ReleaseService["role"]; name: string }[] =
    strategy === "blueGreen"
      ? [
          { role: "active", name: str(s.activeService) },
          { role: "preview", name: str(s.previewService) },
        ]
      : strategy === "canary"
        ? [
            { role: "stable", name: str(s.stableService) },
            { role: "canary", name: str(s.canaryService) },
          ]
        : [];
  const ns = str(rec(ro.metadata).namespace);
  return wanted
    .filter((w) => w.name)
    .map((w) => {
      const base: ReleaseService = { role: w.role, name: text(w.name), found: null };
      if (services === null) return base;
      const svc = services.find((x) => str(rec(x.metadata).name) === w.name && (str(rec(x.metadata).namespace) || ns) === ns);
      if (!svc) return { ...base, found: false };
      const out: ReleaseService = { ...base, found: true };
      if (strategy === "blueGreen") {
        const hash = str(rec(rec(svc.spec).selector)[HASH]);
        const rs = hash ? rawSets.find((r) => str(rec(rec(r.metadata).labels)[HASH]) === hash && ownedByRollout(r, ro)) : undefined;
        const rev = rs ? sets.find((x) => x.name === str(rec(rs.metadata).name))?.revision : undefined;
        if (rev) out.selectsRevision = rev;
      }
      return out;
    });
}

function buildMetric(m: Obj): ReleaseMetric {
  const phase = str(m.phase) || "Pending";
  const parts: string[] = [];
  for (const [key, word] of [["successful", "successful"], ["failed", "failed"], ["inconclusive", "inconclusive"], ["error", "errors"]] as const) {
    const n = num(m[key]);
    if (n > 0) parts.push(`${n} ${word}`);
  }
  const ms = arr(m.measurements);
  const last = rec(ms[ms.length - 1]);
  const lastValue = text(last.value);
  const bad = ["failed", "error", "inconclusive"].includes(phase.toLowerCase());
  const failure = bad ? text(m.message) || text(last.message) : "";
  const out: ReleaseMetric = { name: text(m.name), phase, tone: rolloutTone(phase), summary: parts.join(", ") || "no measurements yet" };
  if (lastValue) out.lastValue = lastValue;
  if (failure) out.failure = failure;
  return out;
}

function buildAnalyses(ro: Obj, runs: Obj[]): ReleaseAnalysis[] {
  return runs
    .filter((r) => ownedByRollout(r, ro))
    .sort((a, b) => str(rec(b.metadata).creationTimestamp).localeCompare(str(rec(a.metadata).creationTimestamp)))
    .map((r) => {
      const st = rec(r.status);
      const phase = str(st.phase) || "Pending";
      return {
        name: str(rec(r.metadata).name),
        phase,
        tone: rolloutTone(phase),
        message: text(st.message),
        metrics: arr(st.metricResults).map((m) => buildMetric(rec(m))),
      };
    });
}

function conditionTone(type: string, status: string, reason: string): StatusTone {
  const on = status === "True";
  if (reason === "ProgressDeadlineExceeded" || (type === "ReplicaFailure" && on) || (type === "InvalidSpec" && on)) return "err";
  if (type === "Paused" && on) return "warn";
  if (type === "Available") return on ? "ok" : "warn";
  if (type === "Completed" && on) return "ok";
  if (type === "Progressing") return on ? "ok" : "warn";
  return "pending";
}

function buildConditions(ro: Obj): ReleaseCondition[] {
  return arr(rec(ro.status).conditions).map((c) => {
    const x = rec(c);
    const type = text(x.type);
    const status = text(x.status);
    const reason = text(x.reason);
    return { type, status, reason, message: text(x.message), tone: conditionTone(type, status, reason) };
  });
}

function haltReason(ro: Obj, analyses: ReleaseAnalysis[]): string | null {
  const status = rec(ro.status);
  if (status.abort === true) {
    const failed = analyses.find((a) => a.phase.toLowerCase() === "failed" || a.phase.toLowerCase() === "error");
    const msg = text(status.message);
    return ["Aborted", msg, failed ? `analysis ${failed.name} ${failed.phase.toLowerCase()}` : ""].filter(Boolean).join(": ");
  }
  const reasons = arr(status.pauseConditions).map((c) => text(rec(c).reason)).filter(Boolean);
  const user = rec(ro.spec).paused === true;
  if (reasons.length === 0 && !user) return null;
  const parts = [...(user ? ["paused by a user"] : []), ...reasons];
  return `Paused: ${parts.join(", ")}`;
}

/**
 * The model behind a Rollout's release view. Pure: it reads the Rollout, the
 * ReplicaSets and AnalysisRuns it owns (by owner UID) and the namespace's
 * Services, and returns plain data. services is null when the user cannot
 * read Services, which keeps "forbidden" distinct from "none". Status text
 * is untrusted: it is truncated and only ever rendered as text, and only an
 * allowlisted set of fields is read (no metadata, args or secret refs).
 */
export function buildReleaseView(ro: Obj, replicaSets: Obj[], analysisRuns: Obj[], services: Obj[] | null): ReleaseView {
  const phase = rolloutPhase(ro);
  const replicas = buildReplicaSets(ro, replicaSets);
  const analyses = buildAnalyses(ro, analysisRuns);
  return {
    strategy: rolloutStrategy(ro),
    phase,
    tone: rolloutTone(phase),
    message: text(rec(ro.status).message),
    steps: buildSteps(ro),
    replicaSets: replicas,
    services: buildServices(ro, replicas, replicaSets, services),
    servicesAvailable: services !== null,
    analyses,
    conditions: buildConditions(ro),
    haltReason: haltReason(ro, analyses),
    actions: availableRolloutActions(ro),
  };
}
