const TOKEN_KEY = "kb.token";

export function getToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t) {
    const url = new URLSearchParams(window.location.search);
    t = url.get("token");
    if (t) {
      localStorage.setItem(TOKEN_KEY, t);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }
  return t ?? "";
}

export interface ClusterInfo {
  id: string;
  context: string;
  server: string;
  status: "connected" | "unreachable" | "degraded";
  version?: string;
  error?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${path}?token=${encodeURIComponent(getToken())}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${path}?token=${encodeURIComponent(getToken())}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export interface PortForwardInfo {
  id: string;
  cluster: string;
  namespace: string;
  pod: string;
  podPort: number;
  localPort: number;
  startedAt: string;
}

export interface PodUsage {
  namespace: string;
  name: string;
  cpuMillis: number;
  memBytes: number;
}

export const api = {
  health: () => get<{ ok: boolean }>("/api/healthz"),
  clusters: () => get<ClusterInfo[]>("/api/clusters"),
  podMetrics: (cluster: string, ns = "*") =>
    get<PodUsage[]>(`/api/metrics/pods?cluster=${encodeURIComponent(cluster)}&ns=${encodeURIComponent(ns)}`),

  pfList: () => get<PortForwardInfo[]>("/api/pf"),
  pfStart: (b: { cluster: string; namespace: string; pod: string; podPort: number; localPort?: number }) =>
    send<PortForwardInfo>("POST", "/api/pf", b),
  pfStop: (id: string) => send<{ stopped: boolean }>("DELETE", `/api/pf/${encodeURIComponent(id)}`),

  scale: (b: { cluster: string; gvr: string; ns: string; name: string; replicas: number }) =>
    send<{ ok: boolean }>("POST", "/api/action/scale", b),
  restart: (b: { cluster: string; gvr: string; ns: string; name: string }) =>
    send<{ ok: boolean }>("POST", "/api/action/restart", b),
  deleteResource: (b: { cluster: string; gvr: string; ns: string; name: string }) =>
    send<{ ok: boolean }>("POST", "/api/action/delete", b),

  getYamlText: async (cluster: string, gvr: string, ns: string, name: string): Promise<string> => {
    const q = new URLSearchParams({ token: getToken(), cluster, gvr, ns, name });
    const res = await fetch(`/api/yaml?${q}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  applyYaml: (b: {
    cluster: string;
    gvr: string;
    ns: string;
    name: string;
    yaml: string;
    dryRun: boolean;
    force: boolean;
  }) => send<{ applied: boolean; dryRun: boolean }>("PUT", "/api/yaml", b),
};
