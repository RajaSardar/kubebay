export interface HelmReleaseRef {
  name: string;
  namespace: string;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}
function s(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/**
 * The Helm release that created an object, from the labels and annotations
 * Helm stamps on what it installs: app.kubernetes.io/managed-by=Helm plus the
 * meta.helm.sh/release-name and release-namespace annotations. Pod templates
 * often carry only the labels, so the instance label stands in for the name
 * when the annotation is absent. Null when the object isn't Helm-managed.
 */
export function helmReleaseOf(obj: Record<string, unknown> | null | undefined): HelmReleaseRef | null {
  const meta = rec(rec(obj).metadata);
  const labels = rec(meta.labels);
  const ann = rec(meta.annotations);
  if (s(labels["app.kubernetes.io/managed-by"]) !== "Helm") return null;
  const name = s(ann["meta.helm.sh/release-name"]) || s(labels["app.kubernetes.io/instance"]);
  if (!name) return null;
  return { name, namespace: s(ann["meta.helm.sh/release-namespace"]) || s(meta.namespace) };
}

/** The Helm page, opened on this release's drawer. */
export function helmReleaseHref(r: HelmReleaseRef): string {
  return `/helm?release=${encodeURIComponent(`${r.namespace}/${r.name}`)}`;
}
