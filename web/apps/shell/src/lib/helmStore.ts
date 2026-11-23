import type { HelmChartEntry, HelmRelease } from "./api";
import { fmtAge } from "./resources";

/**
 * The releases a chart runs as. A release record keeps its chart's name but not
 * its repo, so two repos' charts of one name both count (docs/HELM_STORE.md).
 */
export function installedAs(releases: readonly HelmRelease[] | undefined, chartName: string): HelmRelease[] {
  return (releases ?? []).filter((r) => r.chart === chartName);
}

/**
 * Whether a release's chart version is one this repository's index lists. The
 * one repo signal a release carries: false means it came from another repo (or
 * the version was pruned from this one); true does not prove it came from here.
 */
export function versionInIndex(r: HelmRelease, versions: readonly { version: string }[]): boolean {
  return versions.some((v) => v.version === r.chartVersion);
}

/**
 * The two versions a values comparison starts on: the installed version against
 * the newest when the chart runs an older one this index lists, else the two
 * newest. Null when there is only one version.
 */
export function compareVersions(
  versions: readonly { version: string }[],
  installed: readonly HelmRelease[],
): { from: string; to: string } | null {
  if (versions.length < 2) return null;
  const to = versions[0]!.version;
  const running = installed.find((r) => r.chartVersion !== to && versionInIndex(r, versions));
  return { from: running?.chartVersion ?? versions[1]!.version, to };
}

/** When a repository's index was last fetched, as the toolbar says it. */
export function indexUpdatedLabel(updated: string | undefined, now: number = Date.now()): string {
  const at = updated ? Date.parse(updated) : NaN;
  if (Number.isNaN(at)) return "Index never fetched";
  return `Index updated ${fmtAge(Math.max(0, now - at))} ago`;
}

/** Whether a chart answers a search: its name, description or keywords. */
export function matchesChart(c: HelmChartEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    c.name.toLowerCase().includes(q) ||
    (c.description ?? "").toLowerCase().includes(q) ||
    (c.keywords ?? []).some((k) => k.toLowerCase().includes(q))
  );
}

/** A chart's name as a Helm release name (lowercase letters, digits and dashes). */
export function releaseNameFor(chartName: string): string {
  return chartName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

/** A link a chart's repo supplied is only a link when it is http or https. */
export function isWebUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
