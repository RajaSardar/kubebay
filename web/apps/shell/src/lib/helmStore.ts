import type { HelmChartEntry, HelmRelease } from "./api";

/**
 * The releases a chart runs as. A release record keeps its chart's name but not
 * its repo, so two repos' charts of one name both count (docs/HELM_STORE.md).
 */
export function installedAs(releases: readonly HelmRelease[] | undefined, chartName: string): HelmRelease[] {
  return (releases ?? []).filter((r) => r.chart === chartName);
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
