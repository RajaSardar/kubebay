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
  return firstOwned(
    targets.map((t) =>
      rows.find((r) => {
        const meta = rec(r?.metadata);
        return str(meta.name) === t.name && str(meta.namespace) === t.ns;
      }),
    ),
  );
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
