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
  if (res.status === 401 && !getToken()) {
    window.location.href = "/api/auth/login";
    throw new Error("login required");
  }
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

export const nodeApi = {
  shellStart: (b: { cluster: string; node: string }) =>
    send<{ namespace: string; pod: string }>("POST", "/api/node-shell", b),
};

export const metricsApi = {
  nodes: (cluster: string) =>
    get<{ name: string; cpuMillis: number; memBytes: number }[]>(`/api/metrics/nodes?cluster=${encodeURIComponent(cluster)}`),
};

export const actionApi = {
  cordon: (b: { cluster: string; node: string; cordon: boolean }) =>
    send<{ ok: boolean }>("POST", "/api/action/cordon", b),
  drain: (b: { cluster: string; node: string; ignoreDaemonsets?: boolean }) =>
    send<{ evicted: string[]; skipped: string[]; errors?: Record<string, string> }>("POST", "/api/action/drain", b),
  triggerCronJob: (b: { cluster: string; ns: string; name: string }) =>
    send<{ job: string }>("POST", "/api/action/trigger-cronjob", b),
  suspendCronJob: (b: { cluster: string; ns: string; name: string; suspend: boolean }) =>
    send<{ ok: boolean }>("POST", "/api/action/suspend-cronjob", b),
};

export const rbacApi = {
  self: (b: { cluster: string; verb: string; group: string; resource: string; ns: string }) =>
    send<{ allowed?: boolean; denied?: boolean; reason?: string }>("POST", "/api/rbac/self", b),
};

export interface HelmRelease {
  name: string;
  namespace: string;
  chart: string;
  chartVersion: string;
  appVersion?: string;
  status: string;
  revision: number;
  updated?: string;
  description?: string;
}

export const helmApi = {
  releases: (cluster: string) => get<HelmRelease[]>(`/api/helm/releases?cluster=${encodeURIComponent(cluster)}`),
  history: (cluster: string, ns: string, name: string) =>
    get<HelmRelease[]>(`/api/helm/history?cluster=${encodeURIComponent(cluster)}&ns=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`),
  valuesText: async (cluster: string, ns: string, name: string): Promise<string> => {
    const q = new URLSearchParams({ token: getToken(), cluster, ns, name });
    const res = await fetch(`/api/helm/values?${q}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  manifestText: async (cluster: string, ns: string, name: string): Promise<string> => {
    const q = new URLSearchParams({ token: getToken(), cluster, ns, name });
    const res = await fetch(`/api/helm/manifest?${q}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  rollback: (b: { cluster: string; ns: string; name: string; revision: number }) =>
    send<{ ok: boolean }>("POST", "/api/helm/rollback", b),
  uninstall: (b: { cluster: string; ns: string; name: string }) =>
    send<{ ok: boolean }>("POST", "/api/helm/uninstall", b),
  upgrade: (b: { cluster: string; ns: string; name: string; chartRef: string; version?: string; valuesYaml: string }) =>
    send<HelmRelease>("POST", "/api/helm/upgrade", b),
};

export interface APIResourceEntry {
  gvr: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
}

export const discoveryApi = {
  apis: (cluster: string) => get<APIResourceEntry[]>(`/api/apis?cluster=${encodeURIComponent(cluster)}`),
};

export interface HelmRepo {
  name: string;
  url: string;
}

export interface HelmChartEntry {
  name: string;
  description: string;
  version: string;
  appVersion?: string;
  versions: number;
}

export const helmMarketApi = {
  repos: (cluster: string) => get<HelmRepo[]>(`/api/helm/repos?cluster=${encodeURIComponent(cluster)}`),
  updateRepos: (cluster: string) =>
    send<Record<string, string>>("POST", `/api/helm/repos/update?cluster=${encodeURIComponent(cluster)}`, {}),
  charts: (cluster: string, repo: string) =>
    get<HelmChartEntry[]>(`/api/helm/charts?cluster=${encodeURIComponent(cluster)}&repo=${encodeURIComponent(repo)}`),
  chartValuesText: async (cluster: string, ref: string, version?: string): Promise<string> => {
    const q = new URLSearchParams({ token: getToken(), cluster, ref });
    if (version) q.set("version", version);
    const res = await fetch(`/api/helm/chart-values?${q}`);
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
};

export interface AppSettings {
  prometheusUrl?: string;
  extraKubeconfigs: string[];
  onlyListedKubeconfigs?: boolean;
}

export const settingsApi = {
  get: () => get<AppSettings>("/api/settings"),
  save: (b: AppSettings) => send<{ ok: boolean; saved: AppSettings }>("POST", "/api/settings", b),
};

export const promApi = {
  queryRange: async (params: { query: string; startMs: number; endMs: number; stepSec: number }): Promise<{ data: { result: { metric: Record<string, string>; values: [number, string][] }[] } }> => {
    const q = new URLSearchParams({
      token: getToken(),
      query: params.query,
      start: String(Math.floor(params.startMs / 1000)),
      end: String(Math.floor(params.endMs / 1000)),
      step: String(params.stepSec),
    });
    const res = await fetch(`/api/prom/query_range?${q}`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
