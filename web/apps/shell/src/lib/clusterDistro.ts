import { rancherCluster } from "./rancher";

/**
 * Detect the Kubernetes distribution from a cluster ID / context name, and
 * its server URL when known (a Rancher-proxied context can have any name).
 * Returns a short lowercase label ("eks", "kind", "gke", …) or "" if unknown.
 */
export function detectDistro(id: string, server = ""): string {
  const s = id.toLowerCase();
  if (server && rancherCluster(server)) return "rancher";
  if (s === "rancher-desktop") return "rancher-desktop";
  if (s.startsWith("arn:aws:eks:")) return "eks";
  if (s.startsWith("kind-") || s === "kind") return "kind";
  if (s === "orbstack" || s.startsWith("orbstack-")) return "orbstack";
  if (s.startsWith("gke_")) return "gke";
  if (s.startsWith("k3d-")) return "k3d";
  if (s.startsWith("k3s-") || s === "k3s") return "k3s";
  if (s === "minikube") return "minikube";
  if (s === "docker-desktop") return "docker";
  if (s.startsWith("aks-") || s.startsWith("aks_") || s.includes("/aks/")) return "aks";
  return "";
}

const PROVIDER_MAP: Record<string, { label: string; cls: string }> = {
  eks:      { label: "AWS EKS",  cls: "badge-eks" },
  gke:      { label: "GKE",      cls: "badge-gke" },
  aks:      { label: "AKS",      cls: "badge-aks" },
  kind:     { label: "kind",     cls: "badge-kind" },
  orbstack: { label: "OrbStack", cls: "badge-orbstack" },
  minikube: { label: "minikube", cls: "badge-minikube" },
  k3s:      { label: "k3s",      cls: "badge-k3s" },
  k3d:      { label: "k3d",      cls: "badge-k3d" },
  docker:   { label: "Docker",   cls: "badge-docker" },
  rancher:  { label: "Rancher",  cls: "badge-rancher" },
  "rancher-desktop": { label: "Rancher Desktop", cls: "badge-rancher-desktop" },
};

/** Returns display label and CSS class for a provider badge. */
export function providerBadge(id: string, server = ""): { label: string; cls: string } {
  const d = detectDistro(id, server);
  return PROVIDER_MAP[d] ?? { label: "–", cls: "badge-default" };
}

/**
 * Returns a human-readable short name for a cluster.
 *
 * Note: `id` is sanitized by the engine (colons/slashes → dashes), so
 * pattern-matching for ARNs and GKE contexts must use `context` which
 * preserves the original kubeconfig context name.
 * Falls back: alias → extract from context → context → id.
 */
export function clusterDisplayName(id: string, context: string, alias?: string): string {
  if (alias) return alias;
  // EKS ARN in context: arn:aws:eks:region:account:cluster/NAME
  const eksMatch = context.match(/cluster\/([^/]+)$/);
  if (eksMatch?.[1]) return eksMatch[1];
  // Kubebay's AKS import: aks_SUB8_GROUP/NAME
  const aksMatch = context.match(/^aks_[0-9a-f]{8}_.+\/([^/]+)$/);
  if (aksMatch?.[1]) return aksMatch[1];
  // GKE context: gke_project_region_NAME
  const gkeMatch = context.match(/^gke_[^_]+_[^_]+_(.+)$/);
  if (gkeMatch?.[1]) return gkeMatch[1];
  return context || id;
}
