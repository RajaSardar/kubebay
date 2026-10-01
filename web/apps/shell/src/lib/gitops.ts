function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export interface GitOpsOwner {
  controller: "argocd" | "flux";
  name: string;
}

// Argo CD's "tracking-id" annotation (used when the app-of-apps sets the
// annotation tracking method) packs `<app-name>:<group>/<Kind>:<ns>/<name>`
// into one string — the app name is everything before the first colon.
function argoAppFromTrackingId(v: string): string {
  const i = v.indexOf(":");
  return i === -1 ? v : v.slice(0, i);
}

/**
 * Detects whether a resource is managed by a GitOps controller, from
 * annotations already present on every streamed object (no extra API calls).
 * Argo CD is checked before Flux since the two are mutually exclusive in
 * practice; `instance` is preferred over `tracking-id` since it's already
 * just the app name with no parsing required.
 */
export function ownerOf(obj: Record<string, unknown> | null | undefined): GitOpsOwner | null {
  const annotations = rec(rec(obj?.metadata).annotations);

  const argoInstance = str(annotations["argocd.argoproj.io/instance"]);
  if (argoInstance) return { controller: "argocd", name: argoInstance };
  const argoTrackingId = str(annotations["argocd.argoproj.io/tracking-id"]);
  if (argoTrackingId) return { controller: "argocd", name: argoAppFromTrackingId(argoTrackingId) };

  const fluxKustomization = str(annotations["kustomize.toolkit.fluxcd.io/name"]);
  if (fluxKustomization) return { controller: "flux", name: fluxKustomization };
  const fluxHelmRelease = str(annotations["helm.toolkit.fluxcd.io/name"]);
  if (fluxHelmRelease) return { controller: "flux", name: fluxHelmRelease };

  return null;
}

/**
 * For a bulk selection (e.g. bulk delete): returns the first GitOps owner
 * found among a list of objects, or null if none are owned. Good enough to
 * decide whether to show a warning at all — the banner names one app, not
 * an exhaustive per-row breakdown.
 */
export function firstOwned(objs: (Record<string, unknown> | null | undefined)[]): GitOpsOwner | null {
  for (const obj of objs) {
    const owner = ownerOf(obj);
    if (owner) return owner;
  }
  return null;
}

export interface DeleteTargetLike {
  ns: string;
  name: string;
}

/**
 * Resolves the GitOps owner (if any) for a bulk-delete confirmation: matches
 * each pending {ns,name} target against the already-streamed rows shown in
 * the table, then defers to firstOwned. A target with no matching row (e.g.
 * it was already deleted elsewhere) is simply skipped, not treated as owned.
 */
export function ownerAmongTargets(
  targets: DeleteTargetLike[],
  rows: (Record<string, unknown> | null | undefined)[],
): GitOpsOwner | null {
  // One pass to index the rows, then a lookup per target: a 340-row bulk delete
  // over 5,000 rows is 5,340 steps, not 1.7 million.
  const byKey = new Map<string, Record<string, unknown> | null | undefined>();
  for (const r of rows) {
    const meta = rec(r?.metadata);
    const k = `${str(meta.namespace)}/${str(meta.name)}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }
  return firstOwned(targets.map((t) => byKey.get(`${t.ns}/${t.name}`)));
}

export function ownerLabel(owner: GitOpsOwner): string {
  return owner.controller === "argocd" ? `Argo CD: ${owner.name}` : `Flux: ${owner.name}`;
}

/**
 * Warns without implying Kubebay will block the change — sometimes an
 * emergency direct edit is the right call. Flux gets its own wording since
 * it *corrects* drift on reconcile rather than just flagging it, unlike Argo
 * which reports OutOfSync and waits for a sync.
 */
export function ownerWarning(owner: GitOpsOwner): string {
  return owner.controller === "argocd"
    ? `Argo CD (${owner.name}) manages this resource and will likely revert this change on its next sync — edit the Git source instead.`
    : `Flux (${owner.name}) manages this resource and will likely revert this change on its next reconcile — edit the Git source instead.`;
}

/**
 * The Helm release that installed this object, if any. Helm 3 writes with
 * Update operations, and an upgrade or rollback re-renders the chart and
 * patches live toward it, so a direct edit lasts only until the next one.
 */
export function helmReleaseOf(obj: Record<string, unknown> | null | undefined): string | null {
  const meta = (obj?.metadata ?? {}) as Record<string, unknown>;
  const annotations = (meta.annotations ?? {}) as Record<string, unknown>;
  const labels = (meta.labels ?? {}) as Record<string, unknown>;
  const fromAnnotation = annotations["meta.helm.sh/release-name"];
  if (typeof fromAnnotation === "string" && fromAnnotation) return fromAnnotation;
  if (labels["app.kubernetes.io/managed-by"] === "Helm") {
    const instance = labels["app.kubernetes.io/instance"];
    return typeof instance === "string" && instance ? instance : "unknown";
  }
  return null;
}

