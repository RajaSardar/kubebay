import { helmApi, type HelmRelease } from "./api";

// ADR 0004: Helm keeps each release revision in a Secret labelled with the
// release's name, status and version. The shell streams those Secrets'
// metadata from the moment a cluster connects (usePrewarm), asking only for
// revisions Helm hasn't superseded, so the Helm page has its rows at once and
// sees every upgrade, rollback and uninstall live. The chart columns come
// from the release list, which the engine decodes, asked for again whenever
// a release moves on.

/** The release Secrets the shell streams. */
export const HELM_SECRETS = { gvr: "v1/secrets", labelSelector: "owner=helm,status!=superseded" } as const;

/** The release list's query, shared by the Helm page and the prefetch on connect. */
export function helmReleasesQuery(cluster: string) {
  return {
    queryKey: ["helm-releases", cluster] as const,
    queryFn: () => helmApi.releases(cluster),
    // The stream says when a release changes; no timer.
    refetchInterval: false as const,
    staleTime: 5 * 60_000,
  };
}

/** A release as its Secrets' labels tell it. */
export interface ReleaseHead {
  namespace: string;
  name: string;
  revision: number;
  status: string;
  updated?: string;
}

function rec(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/** Each release's newest revision, from the release Secrets' labels, sorted by namespace and name. */
export function helmRowsFromSecrets(rows: readonly unknown[]): ReleaseHead[] {
  const newest = new Map<string, ReleaseHead>();
  for (const row of rows) {
    const meta = rec(rec(row).metadata);
    const labels = rec(meta.labels) as Record<string, string | undefined>;
    const namespace = typeof meta.namespace === "string" ? meta.namespace : "";
    const name = labels.name ?? "";
    const revision = parseInt(labels.version ?? "", 10);
    if (!namespace || !name || !(revision > 0)) continue;
    const key = `${namespace}/${name}`;
    if ((newest.get(key)?.revision ?? 0) >= revision) continue;
    const head: ReleaseHead = { namespace, name, revision, status: labels.status ?? "unknown" };
    const at = parseInt(labels.modifiedAt ?? "", 10);
    if (at > 0) head.updated = new Date(at * 1000).toISOString();
    newest.set(key, head);
  }
  return [...newest.values()].sort((a, b) => `${a.namespace}/${a.name}`.localeCompare(`${b.namespace}/${b.name}`));
}

/** The rows the page shows: the stream's releases, as they are now, with the
 *  chart columns from the list; the list alone until the stream has any. */
export function mergeReleases(heads: readonly ReleaseHead[] | null, listed: readonly HelmRelease[] | undefined): HelmRelease[] {
  if (!heads) return [...(listed ?? [])];
  const byKey = new Map((listed ?? []).map((r) => [`${r.namespace}/${r.name}`, r]));
  return heads.map((h) => {
    const l = byKey.get(`${h.namespace}/${h.name}`);
    if (l) return { ...l, revision: h.revision, status: h.status };
    return { namespace: h.namespace, name: h.name, revision: h.revision, status: h.status, chart: "", chartVersion: "", ...(h.updated ? { updated: h.updated } : {}) };
  });
}

/** Changes whenever a release is added, removed, upgraded or changes status. */
export function releasesFingerprint(heads: readonly ReleaseHead[]): string {
  return heads
    .map((h) => `${h.namespace}/${h.name}@${h.revision}:${h.status}`)
    .sort()
    .join("|");
}
