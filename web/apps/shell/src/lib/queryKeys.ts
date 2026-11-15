/**
 * Centralized query key factory.
 * All cluster-scoped queries MUST include the cluster id as first element
 * so invalidateQueries({ queryKey: [clusterId] }) clears them all on switch.
 */

export const STALE = {
  short: 30_000,       // fast-moving data (pods, events)
  medium: 5 * 60_000,  // slow-moving data (CRDs, API discovery)
  long: 10 * 60_000,   // nearly static (helm repos)
} as const;

export const GC = {
  default: 10 * 60_000, // keep inactive data in memory 10 minutes
} as const;

export const QK = {
  // Global (not cluster-scoped)
  health: () => ["health"] as const,
  clusters: () => ["clusters"] as const,

  // Cluster-scoped
  apis: (cluster: string) => [cluster, "apis"] as const,
  crds: (cluster: string) => [cluster, "crds"] as const,
  pf: (cluster: string) => [cluster, "pf"] as const,
  helmReleases: (cluster: string) => [cluster, "helm-releases"] as const,
  helmHistory: (cluster: string, ns: string, name: string) => [cluster, "helm-history", ns, name] as const,
  helmValues: (cluster: string, ns: string, name: string) => [cluster, "helm-values", ns, name] as const,
  helmManifest: (cluster: string, ns: string, name: string) => [cluster, "helm-manifest", ns, name] as const,
  helmRepos: (cluster: string) => [cluster, "helm-repos"] as const,
  helmCharts: (cluster: string, repo: string) => [cluster, "helm-charts", repo] as const,
} as const;
