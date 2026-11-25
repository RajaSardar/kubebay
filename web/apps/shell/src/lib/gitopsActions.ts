type Obj = Record<string, unknown>;

function rec(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** What every GitOps action sends through the existing YAML apply path (impersonated as the user, audit-logged). */
export interface GitOpsTarget {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
}

function mergeRequest(target: GitOpsTarget, action: string, doc: Obj) {
  return {
    cluster: target.cluster,
    gvr: target.gvr,
    ns: target.ns,
    name: target.name,
    yaml: JSON.stringify(doc),
    dryRun: false,
    force: false,
    mode: "merge" as const,
    action,
  };
}

// ── Flux ─────────────────────────────────────────────────────────────────────

export type FluxAction = "reconcile" | "suspend" | "resume";

export const FLUX_ACTION_LABELS: Record<FluxAction, string> = { reconcile: "Reconcile", suspend: "Suspend", resume: "Resume" };

export interface FluxKindInfo {
  kind: string;
  /** The controller honours the reconcile.fluxcd.io/requestedAt annotation. */
  reconcile: boolean;
  /** The kind has spec.suspend. */
  suspend: boolean;
}

// Only the kinds whose controllers support the action (an ImagePolicy has no spec.suspend).
const FLUX_KINDS: Record<string, FluxKindInfo> = {
  "kustomize.toolkit.fluxcd.io/kustomizations": { kind: "Kustomization", reconcile: true, suspend: true },
  "helm.toolkit.fluxcd.io/helmreleases": { kind: "HelmRelease", reconcile: true, suspend: true },
  "source.toolkit.fluxcd.io/gitrepositories": { kind: "GitRepository", reconcile: true, suspend: true },
  "source.toolkit.fluxcd.io/helmrepositories": { kind: "HelmRepository", reconcile: true, suspend: true },
  "source.toolkit.fluxcd.io/helmcharts": { kind: "HelmChart", reconcile: true, suspend: true },
  "source.toolkit.fluxcd.io/ocirepositories": { kind: "OCIRepository", reconcile: true, suspend: true },
  "source.toolkit.fluxcd.io/buckets": { kind: "Bucket", reconcile: true, suspend: true },
  "image.toolkit.fluxcd.io/imagerepositories": { kind: "ImageRepository", reconcile: true, suspend: true },
  "image.toolkit.fluxcd.io/imageupdateautomations": { kind: "ImageUpdateAutomation", reconcile: true, suspend: true },
  "image.toolkit.fluxcd.io/imagepolicies": { kind: "ImagePolicy", reconcile: true, suspend: false },
};

/** "group/version/resource" -> its parts; null for a core-group or malformed GVR. */
function splitGvr(gvr: string): [string, string, string] | null {
  const p = gvr.split("/");
  return p.length === 3 ? [p[0]!, p[1]!, p[2]!] : null;
}

/** The Flux kind a GVR is, with what it supports; null when it is not a Flux kind that has a GitOps action. */
export function fluxKindOf(gvr: string): FluxKindInfo | null {
  const p = splitGvr(gvr);
  return p ? FLUX_KINDS[`${p[0]}/${p[2]}`] ?? null : null;
}

export function fluxSuspended(obj: Obj | null | undefined): boolean {
  return rec(rec(obj).spec).suspend === true;
}

/** The actions that make sense now: a suspended object only resumes (the controller ignores a reconcile request). */
export function availableFluxActions(gvr: string, obj: Obj | null | undefined): FluxAction[] {
  const info = fluxKindOf(gvr);
  if (!info) return [];
  if (fluxSuspended(obj)) return info.suspend ? ["resume"] : [];
  const out: FluxAction[] = [];
  if (info.reconcile) out.push("reconcile");
  if (info.suspend) out.push("suspend");
  return out;
}

/**
 * The merge patch for a Flux action, the same fields the flux CLI sets:
 *   reconcile: metadata.annotations["reconcile.fluxcd.io/requestedAt"] = now
 *   suspend / resume: spec.suspend true / false (the spec change itself
 *     makes the controller reconcile on resume).
 */
export function fluxActionRequest(target: GitOpsTarget, action: FluxAction, now: Date = new Date()) {
  const info = fluxKindOf(target.gvr);
  const p = splitGvr(target.gvr);
  if (!info || !p) throw new Error(`${target.gvr} is not a Flux kind`);
  if (action === "reconcile" ? !info.reconcile : !info.suspend) throw new Error(`${info.kind} does not support ${action}`);
  const metadata: Obj = { name: target.name, namespace: target.ns };
  const doc: Obj = { apiVersion: `${p[0]}/${p[1]}`, kind: info.kind, metadata };
  if (action === "reconcile") metadata.annotations = { "reconcile.fluxcd.io/requestedAt": now.toISOString() };
  else doc.spec = { suspend: action === "suspend" };
  return mergeRequest(target, `flux-${action}`, doc);
}

// ── Argo CD ──────────────────────────────────────────────────────────────────

export const ARGO_APPLICATIONS_GVR = "argoproj.io/v1alpha1/applications";

/** spec.syncPolicy.automated present (even as {}): Argo CD syncs the app back to Git by itself. */
export function argoAutomatedSync(app: Obj | null | undefined): boolean {
  const a = rec(rec(rec(app).spec).syncPolicy).automated;
  return !!a && typeof a === "object";
}

export interface ArgoHistoryEntry {
  id: number;
  revision: string;
  deployedAt: string;
  /** "repoURL path" of the entry's first source, for display. */
  sourceLabel: string;
}

function historyItems(app: Obj | null | undefined): Obj[] {
  return arr(rec(rec(app).status).history)
    .map(rec)
    .filter((h) => typeof h.id === "number");
}

/** status.history, newest first. */
export function argoHistory(app: Obj | null | undefined): ArgoHistoryEntry[] {
  return historyItems(app)
    .map((h) => {
      const src = rec(h.source ?? arr(h.sources)[0]);
      return {
        id: h.id as number,
        revision: str(h.revision),
        deployedAt: str(h.deployedAt),
        sourceLabel: [str(src.repoURL), str(src.path)].filter(Boolean).join(" "),
      };
    })
    .sort((a, b) => b.id - a.id);
}

/** Why a rollback cannot be started, or null. Argo CD refuses it under automated sync, since the next sync would undo it. */
export function argoRollbackBlocker(app: Obj | null | undefined): string | null {
  if (argoAutomatedSync(app)) {
    return "Automated sync is enabled, so a rollback would be reverted immediately: Argo CD syncs the app back to Git. Turn off automated sync in the sync policy first, or change the Git revision instead.";
  }
  if (Object.keys(rec(rec(app).operation)).length > 0) return "An operation is already running on this Application. Wait for it to finish.";
  if (historyItems(app).length === 0) return "This Application has no history to roll back to.";
  return null;
}

/**
 * The merge patch the Argo CD API's rollback applies: operation.sync with the
 * history entry's revision and source(s), the app's own sync options, and the
 * user's prune choice. Argo CD's application controller picks the operation up.
 */
export function argoRollbackRequest(target: GitOpsTarget, app: Obj, historyId: number, opts: { prune: boolean }) {
  const blocker = argoRollbackBlocker(app);
  if (blocker) throw new Error(blocker);
  const entry = historyItems(app).find((h) => h.id === historyId);
  if (!entry) throw new Error(`No history entry ${historyId} on this Application`);
  const sync: Obj = { revision: str(entry.revision) };
  if (Array.isArray(entry.revisions) && entry.revisions.length > 0) sync.revisions = entry.revisions;
  sync.prune = opts.prune;
  const syncOptions = rec(rec(app.spec).syncPolicy).syncOptions;
  if (Array.isArray(syncOptions) && syncOptions.length > 0) sync.syncOptions = syncOptions;
  if (Array.isArray(entry.sources) && entry.sources.length > 0) sync.sources = entry.sources;
  else if (entry.source && typeof entry.source === "object") sync.source = entry.source;
  const doc = { apiVersion: "argoproj.io/v1alpha1", kind: "Application", metadata: { name: target.name, namespace: target.ns }, operation: { sync } };
  return mergeRequest(target, "argocd-rollback", doc);
}

// ── Confirmation text ────────────────────────────────────────────────────────

export type GitOpsAction = FluxAction | "argocd-rollback";

/** Plain lines for the confirmation dialog: what the action touches, from what the object already reports. */
export function gitopsActionImpact(action: GitOpsAction, obj: Obj | null | undefined, opts: { prune?: boolean } = {}): string[] {
  const inventory = arr(rec(rec(rec(obj).status).inventory).entries).length;
  const plural = (n: number) => `${n} resource${n === 1 ? "" : "s"}`;
  switch (action) {
    case "reconcile":
      return [
        inventory > 0
          ? `Re-applies the desired state from Git now; it manages ${plural(inventory)}, and anything that drifted is corrected.`
          : "Re-applies the desired state from its source now; anything that drifted is corrected.",
      ];
    case "suspend":
      return ["Flux stops reconciling this object: changes in Git are not applied and drift is not corrected until you resume it."];
    case "resume":
      return ["Flux reconciles again, and applies whatever is in Git now, including changes made while it was suspended."];
    case "argocd-rollback": {
      const n = arr(rec(rec(obj).status).resources).length;
      return [
        `Syncs the Application to the chosen revision${n > 0 ? `, which can change any of its ${plural(n)}` : ""}.`,
        opts.prune ? "Prune is on: resources that revision does not define are deleted." : "Prune is off: resources that revision does not define are left in place.",
      ];
    }
  }
}
