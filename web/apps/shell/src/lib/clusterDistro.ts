/**
 * Detect the Kubernetes distribution from a cluster ID / context name.
 * Returns a short lowercase label ("eks", "kind", "gke", …) or "" if unknown.
 */
export function detectDistro(id: string): string {
  const s = id.toLowerCase();
  if (s.startsWith("arn:aws:eks:")) return "eks";
  if (s.startsWith("kind-") || s === "kind") return "kind";
  if (s === "orbstack" || s.startsWith("orbstack-")) return "orbstack";
  if (s.startsWith("gke_")) return "gke";
  if (s.startsWith("k3d-")) return "k3d";
  if (s.startsWith("k3s-") || s === "k3s") return "k3s";
  if (s === "minikube") return "minikube";
  if (s === "docker-desktop") return "docker";
  return "";
}
