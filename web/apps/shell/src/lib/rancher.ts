/**
 * KB-08: recognise Rancher without ever touching a Rancher API token. The
 * kubeconfig stays the only credential; these read the server URL and the
 * namespace metadata Kubebay already has.
 */

const PROJECT = "field.cattle.io/projectId";

/**
 * A context whose server is Rancher's cluster proxy
 * (https://<rancher>/k8s/clusters/<id>), and that cluster's page in the
 * Rancher dashboard. An Authorized Cluster Endpoint context points at the
 * cluster directly, so it returns null.
 */
export function rancherCluster(server: string): { id: string; dashboard: string } | null {
  let u: URL;
  try {
    u = new URL(server);
  } catch {
    return null;
  }
  const m = u.pathname.match(/^\/k8s\/clusters\/([A-Za-z0-9-]+)\/?$/);
  if (u.protocol !== "https:" || !m?.[1]) return null;
  return { id: m[1], dashboard: `${u.origin}/dashboard/c/${m[1]}/explorer` };
}

/** The Rancher project a namespace belongs to ("p-xyz"), or "". */
export function rancherProject(meta: { annotations?: Record<string, string>; labels?: Record<string, string> } | undefined): string {
  const a = meta?.annotations?.[PROJECT];
  if (a) return a.includes(":") ? a.slice(a.indexOf(":") + 1) : a;
  return meta?.labels?.[PROJECT] ?? "";
}

/** Namespaces grouped by project, projects sorted, the unassigned last. */
export function groupByProject(namespaces: { name: string; project: string }[]): { project: string; names: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const n of namespaces) groups.set(n.project, [...(groups.get(n.project) ?? []), n.name]);
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([project, names]) => ({ project, names: names.sort() }));
}
