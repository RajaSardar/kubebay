import { PolicyRejectionError, StaleEditError, type PolicyRejectionDetail } from "./policyRejection";
import type { HistoryPoint } from "./headroomForecast";

declare global {
  interface Window {
    /** Injected by the desktop wrapper before the page loads. */
    __KUBEBAY_TOKEN__?: string;
  }
}

// The token buys cluster read/write — and, once the local shell lands, code
// execution as the user. So it lives in memory for the life of the page only:
// not in localStorage (which kept it on disk forever, readable by anything that
// can reach the origin) and not in the URL (history, referrers, server logs).
// The desktop wrapper re-injects it on every load, so a reload costs nothing.
let sessionToken = typeof window !== "undefined" ? (window.__KUBEBAY_TOKEN__ ?? "") : "";

// Evict what older builds persisted, so upgrading actually removes it from disk.
try {
  localStorage.removeItem("kb.token");
} catch {
  /* storage disabled */
}

export function getToken(): string {
  return sessionToken;
}

export function setToken(token: string): void {
  sessionToken = token;
}

export type AuthMode = "oidc" | "token" | "open";

/** How this engine wants to be authenticated. Public: it names no secret. */
export async function authMode(): Promise<AuthMode> {
  const res = await fetch("/api/auth-mode");
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const body = (await res.json()) as { mode?: AuthMode };
  return body.mode ?? "token";
}

/** Verifies a pasted token against the engine before the app starts using it. */
export async function checkToken(token: string): Promise<boolean> {
  const res = await fetch("/api/clusters", { headers: { "X-Kubebay-Token": token } });
  return res.ok;
}

export interface ClusterInfo {
  id: string;
  context: string;
  server: string;
  status: "connected" | "unreachable" | "degraded" | "misconfigured";
  version?: string;
  error?: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, {
    headers: { "X-Kubebay-Token": getToken() },
  });
  if (res.status === 401 && !getToken()) {
    window.location.href = "/api/auth/login";
    throw new Error("login required");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Kubebay-Token": getToken() };
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throwIfPolicyRejection(res, text);
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// A policy rejection comes back as structured JSON (see parsePolicyRejection
// in the engine, and writePolicyRejectionOrError which every mutating
// handler now routes through — backlog #17) on any mutating endpoint, not
// just /api/yaml; everything else stays the existing plain-text error.
function throwIfPolicyRejection(res: Response, text: string): void {
  if (!res.headers.get("Content-Type")?.includes("application/json")) return;
  try {
    const body = JSON.parse(text) as { error?: string; policyRejection?: PolicyRejectionDetail; paths?: string[]; message?: string };
    if (body.error === "policy-rejected" && body.policyRejection) {
      throw new PolicyRejectionError(body.policyRejection);
    }
    if (body.error === "changed-since-load" && Array.isArray(body.paths)) {
      throw new StaleEditError(body.paths, body.message);
    }
  } catch (e) {
    if (e instanceof PolicyRejectionError || e instanceof StaleEditError) throw e;
    // Malformed JSON body — fall through to the plain-text error in send().
  }
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

  scale: (b: { cluster: string; gvr: string; ns: string; name: string; replicas: number; gitopsOwner?: string }) =>
    send<{ ok: boolean }>("POST", "/api/action/scale", b),
  restart: (b: { cluster: string; gvr: string; ns: string; name: string; gitopsOwner?: string }) =>
    send<{ ok: boolean }>("POST", "/api/action/restart", b),
  deleteResource: (b: {
    cluster: string;
    gvr: string;
    ns: string;
    name: string;
    graceSeconds?: number;
    forceFinalizers?: boolean;
    gitopsOwner?: string;
  }) => send<{ ok: boolean }>("POST", "/api/action/delete", b),
  resizePod: (b: {
    cluster: string;
    ns: string;
    name: string;
    container: string;
    resources: { requests?: Record<string, string>; limits?: Record<string, string> };
    gitopsOwner?: string;
  }) => send<{ ok: boolean }>("POST", "/api/action/resize-pod", b),

  getYamlText: async (cluster: string, gvr: string, ns: string, name: string): Promise<string> => {
    return fetchObject(cluster, gvr, ns, name, "yaml");
  },
  /** Same object as getYamlText, but served as JSON so callers get a parsed object. */
  getObject: async (
    cluster: string,
    gvr: string,
    ns: string,
    name: string,
  ): Promise<Record<string, unknown>> => {
    return JSON.parse(await fetchObject(cluster, gvr, ns, name, "json")) as Record<string, unknown>;
  },
  applyYaml: applyYamlRequest,
  createResource: (b: { cluster: string; yaml: string; dryRun: boolean }) =>
    send<{ applied: number; total: number; dryRun: boolean }>("POST", "/api/yaml/create", b),
  auditLog: () => get<{ time: string; action: string; cluster: string; namespace?: string; resource?: string; detail?: string; userAgent?: string }[]>("/api/audit"),
};

export const secretApi = {
  /** Reveals exactly one key of one Secret -- never the whole object. Every call is audited engine-side. */
  revealValue: (b: { cluster: string; ns: string; name: string; key: string }) =>
    get<{ value: string }>(
      `/api/secret-value?cluster=${encodeURIComponent(b.cluster)}&ns=${encodeURIComponent(b.ns)}&name=${encodeURIComponent(b.name)}&key=${encodeURIComponent(b.key)}`,
    ),
};

function applyYamlRequest(b: {
  cluster: string;
  gvr: string;
  ns: string;
  name: string;
  yaml: string;
  dryRun: boolean;
  force: boolean;
  action?: string;
  /**
   * The YAML as loaded into the editor. When sent, the engine patches only
   * the fields that differ (an Update, like `kubectl edit`) instead of
   * server-side applying the whole object, which conflicts with fields other
   * managers (Helm, kubectl) own.
   */
  original?: string;
  /** "strategic": the yaml is itself a strategic merge patch of the fields to change. */
  mode?: "strategic";
}): Promise<{
  applied: boolean;
  dryRun: boolean;
  resultYaml?: string;
  noop?: boolean;
  patchType?: "strategic" | "merge" | "apply";
  /** Edited field paths; never values. */
  changedPaths?: string[];
}> {
  return send("PUT", "/api/yaml", b);
}

async function fetchObject(
  cluster: string,
  gvr: string,
  ns: string,
  name: string,
  format: "yaml" | "json",
): Promise<string> {
  const q = new URLSearchParams({ cluster, gvr, ns, name });
  if (format === "json") q.set("format", "json");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`/api/yaml?${q}`, {
      signal: ctrl.signal,
      headers: { "X-Kubebay-Token": getToken() },
    });
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  } finally {
    clearTimeout(timer);
  }
}

/** Short-lived network diagnostic pod (roadmap Tier 2 #23); delete it with api.deleteResource when done. */
export const netdiagApi = {
  start: (b: { cluster: string; namespace: string; node?: string; image?: string }) =>
    send<{ namespace: string; pod: string }>("POST", "/api/netdiag", b),
};

/** One running image digest's signature status (roadmap Tier 2 #17). */
export interface ImageSignatureRow {
  image: string;
  registry?: string;
  repo?: string;
  digest?: string;
  status: "signed" | "unsigned" | "unknown";
  method?: string;
  reason?: string;
  pods: number;
  namespaces: string[];
}

/** Contacts each running image's registry anonymously; only call on an explicit user action. */
export const imageSigApi = {
  check: (cluster: string) => get<ImageSignatureRow[]>(`/api/image-signatures?cluster=${encodeURIComponent(cluster)}`),
};

export interface AuditSecurityEvent {
  id: string;
  time: string;
  rule: string;
  severity: "high" | "medium" | "low";
  title: string;
  user: string;
  sourceIP?: string;
  object: string;
  detail?: string;
  allowed: boolean;
}

export interface AuditEventsResponse {
  configured: boolean;
  path?: string;
  error?: string;
  events: AuditSecurityEvent[];
}

/** Roadmap #26: security events from a cluster's API server audit log, read locally. */
export const securityApi = {
  auditEvents: (cluster: string) => get<AuditEventsResponse>(`/api/security/audit-events?cluster=${encodeURIComponent(cluster)}`),
  setAuditLogPath: (cluster: string, path: string) =>
    send<{ ok: boolean; path: string }>("PUT", "/api/security/audit-log-path", { cluster, path }),
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
  cordon: (b: { cluster: string; node: string; cordon: boolean; gitopsOwner?: string }) =>
    send<{ ok: boolean }>("POST", "/api/action/cordon", b),
  drain: (b: { cluster: string; node: string; ignoreDaemonsets?: boolean; gitopsOwner?: string }) =>
    send<{ evicted: string[]; skipped: string[]; errors?: Record<string, string> }>("POST", "/api/action/drain", b),
  triggerCronJob: (b: { cluster: string; ns: string; name: string }) =>
    send<{ job: string }>("POST", "/api/action/trigger-cronjob", b),
  suspendCronJob: (b: { cluster: string; ns: string; name: string; suspend: boolean }) =>
    send<{ ok: boolean }>("POST", "/api/action/suspend-cronjob", b),
};

export interface RBACRule {
  verbs: string[];
  apiGroups: string[];
  resources: string[];
  resourceNames?: string[];
  nonResourceURLs?: string[];
}

export interface RBACFinding {
  severity: "high" | "medium";
  title: string;
  subject: string;
  roleRef: string;
  why: string;
  rule?: string;
  suggestion?: string;
  verb?: string;
  group?: string;
  resource?: string;
}

export interface RBACSnapshot {
  roles: { name: string; ns?: string; kind: string; rules: RBACRule[] }[];
  clusterRoles: { name: string; ns?: string; kind: string; rules: RBACRule[] }[];
  roleBindings: { name: string; ns?: string; kind: string; roleRef: string; subjects: { kind: string; name: string; ns?: string }[] }[];
  clusterRoleBindings: { name: string; ns?: string; kind: string; roleRef: string; subjects: { kind: string; name: string; ns?: string }[] }[];
  findings: RBACFinding[];
}

export const rbacApi = {
  self: (b: { cluster: string; verb: string; group: string; resource: string; ns: string }) =>
    send<{ allowed?: boolean; denied?: boolean; reason?: string }>("POST", "/api/rbac/self", b),
  all: (cluster: string) => get<RBACSnapshot>(`/api/rbac/all?cluster=${encodeURIComponent(cluster)}`),
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
  manifest?: string;
}

export const helmApi = {
  releases: (cluster: string) => get<HelmRelease[]>(`/api/helm/releases?cluster=${encodeURIComponent(cluster)}`),
  history: (cluster: string, ns: string, name: string) =>
    get<HelmRelease[]>(`/api/helm/history?cluster=${encodeURIComponent(cluster)}&ns=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`),
  valuesText: async (cluster: string, ns: string, name: string): Promise<string> => {
    const q = new URLSearchParams({ cluster, ns, name });
    const res = await fetch(`/api/helm/values?${q}`, { headers: { "X-Kubebay-Token": getToken() } });
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  manifestText: async (cluster: string, ns: string, name: string): Promise<string> => {
    const q = new URLSearchParams({ cluster, ns, name });
    const res = await fetch(`/api/helm/manifest?${q}`, { headers: { "X-Kubebay-Token": getToken() } });
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
  rollback: (b: { cluster: string; ns: string; name: string; revision: number }) =>
    send<{ ok: boolean }>("POST", "/api/helm/rollback", b),
  uninstall: (b: { cluster: string; ns: string; name: string }) =>
    send<{ ok: boolean }>("POST", "/api/helm/uninstall", b),
  upgrade: (b: { cluster: string; ns: string; name: string; chartRef: string; version?: string; valuesYaml: string; dryRun?: boolean }) =>
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
  // Every apiVersion the server currently serves (not just the preferred one
  // per group) -- backlog #25's Upgrade Readiness Panel needs this to tell
  // whether a soon-to-be-removed version is still actually being served.
  apiVersions: (cluster: string) => get<string[]>(`/api/apiversions?cluster=${encodeURIComponent(cluster)}`),
};

export interface PrinterColumn {
  name: string;
  jsonPath: string;
  type: string;
}

export interface CRDEntry {
  name: string;
  group: string;
  version: string;
  resource: string;
  kind: string;
  namespaced: boolean;
  gvr: string;
  columns: PrinterColumn[];
}

export const crdApi = {
  list: (cluster: string) => get<CRDEntry[]>(`/api/crds?cluster=${encodeURIComponent(cluster)}`),
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
  addRepo: (b: { name: string; url: string }) => send<HelmRepo>("POST", "/api/helm/repos/add", b),
  updateRepos: (cluster: string) =>
    send<Record<string, string>>("POST", `/api/helm/repos/update?cluster=${encodeURIComponent(cluster)}`, {}),
  charts: (cluster: string, repo: string) =>
    get<HelmChartEntry[]>(`/api/helm/charts?cluster=${encodeURIComponent(cluster)}&repo=${encodeURIComponent(repo)}`),
  chartValuesText: async (cluster: string, ref: string, version?: string): Promise<string> => {
    const q = new URLSearchParams({ cluster, ref });
    if (version) q.set("version", version);
    const res = await fetch(`/api/helm/chart-values?${q}`, { headers: { "X-Kubebay-Token": getToken() } });
    if (!res.ok) throw new Error(await res.text());
    return res.text();
  },
};

/**
 * Local-shell capability, straight from the engine. `available` is the only
 * field that decides whether a shell can be opened; `enabled` without
 * `available` is the case worth explaining, and `reason` says why.
 * Absent entirely on an engine older than this field.
 */
export interface LocalShellCapability {
  available: boolean;
  enabled: boolean;
  reason?: string;
  kubectl?: { found: boolean; version?: string };
}

export interface AppSettings {
  /** Fallback for clusters with no entry in prometheusUrls. */
  prometheusUrl?: string;
  prometheusUrls?: Record<string, string>;
  extraKubeconfigs: string[];
  onlyListedKubeconfigs?: boolean;
  activeKubeconfigs?: string[];
  nodeShellImage?: string;
  nodeShellImageDefault?: string;
  localShell?: LocalShellCapability;
  /** Usage-history consent per cluster (backlog #36): true once connected, false after Stop. */
  historyClusters?: Record<string, boolean>;
}

export const settingsApi = {
  get: () => get<AppSettings>("/api/settings"),
  save: (b: AppSettings) => send<{ ok: boolean; saved: AppSettings }>("POST", "/api/settings", b),
};

export interface HistoryCoverage {
  retentionDays: number;
  expectedHours: number;
  observedHours: number;
  wellSampledHours: number;
  distinctDays: number;
  longestGapHours: number;
  first: string | null;
  hourOfDayObserved: number[];
  weekendObserved: boolean;
  /** Engine-computed, e.g. "observed 09–18 local, weekdays only"; show it next to anything derived from history. */
  label: string;
}

export interface HistoryStatus {
  cluster: string;
  available: boolean;
  reason?: string;
  recording: boolean;
  readOnly?: boolean;
  path?: string;
  retentionDays?: number;
  coverage?: HistoryCoverage;
}

/** One hourly series from `GET /api/history/series`; `ns` "" is the cluster total. */
export interface HistorySeries {
  ns: string;
  source: "local" | "prometheus";
  points: HistoryPoint[];
  coverage: HistoryCoverage;
}

const q = (cluster: string) => `cluster=${encodeURIComponent(cluster)}`;

/** Local usage history (backlog #36): consent, status and erase. */
export const historyApi = {
  enroll: (cluster: string) => send<{ recording: boolean }>("POST", `/api/history/enroll?${q(cluster)}`),
  setRecording: (cluster: string, on: boolean) => send<{ recording: boolean }>("PUT", `/api/history/recording?${q(cluster)}&on=${on}`),
  erase: (cluster: string) => send<{ erased: number }>("DELETE", `/api/history?${q(cluster)}`),
  status: (cluster: string) => get<HistoryStatus>(`/api/history/status?${q(cluster)}`),
  /** Cluster-total hourly series from local history; from/to are RFC 3339 and must lie within retention. */
  series: (cluster: string, from: string, to: string) =>
    get<HistorySeries>(`/api/history/series?${q(cluster)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
};

export interface ArgoCDResource {
  group: string;
  kind: string;
  namespace: string;
  name: string;
  status: string;
  health: string;
}

export interface ArgoCDApp {
  name: string;
  namespace: string;
  project: string;
  repoURL: string;
  targetRevision: string;
  syncStatus: string;
  healthStatus: string;
  lastSyncTime: string;
  message: string;
  resources: ArgoCDResource[];
}

export interface ArgoCDAppsResponse {
  installed: boolean;
  apps: ArgoCDApp[];
}

export const argoCDApi = {
  apps: (cluster: string) =>
    get<ArgoCDAppsResponse>(`/api/argocd/apps?cluster=${encodeURIComponent(cluster)}`),
  sync: (b: { cluster: string; namespace: string; name: string }) =>
    send<{ ok: boolean }>("POST", "/api/argocd/sync", b),
};

export interface WorkloadWaste {
  cluster: string;
  ns: string;
  kind: string;
  name: string;
  podCount: number;
  requestedCpuMillis: number;
  requestedMemBytes: number;
  p95CpuMillis: number;
  p95MemBytes: number;
  source: string;
  window: string;
}

export const wasteApi = {
  workloads: (cluster: string) =>
    get<WorkloadWaste[]>(`/api/waste/workloads?cluster=${encodeURIComponent(cluster)}`),
};

export const promApi = {
  queryRange: async (params: { cluster: string; query: string; startMs: number; endMs: number; stepSec: number }): Promise<{ data: { result: { metric: Record<string, string>; values: [number, string][] }[] } }> => {
    const q = new URLSearchParams({
      cluster: params.cluster,
      query: params.query,
      start: String(Math.floor(params.startMs / 1000)),
      end: String(Math.floor(params.endMs / 1000)),
      step: String(params.stepSec),
    });
    const res = await fetch(`/api/prom/query_range?${q}`, { headers: { "X-Kubebay-Token": getToken() } });
    if (!res.ok) {
      const text = await res.text();
      let json: { error?: string; hint?: string } | undefined;
      try {
        json = JSON.parse(text) as { error?: string; hint?: string };
      } catch {
        json = undefined;
      }
      if (json?.error === "prometheus-unreachable") {
        const e = new Error(json.hint || "prometheus-unreachable");
        (e as { cause?: { hint?: string } }).cause = { hint: json.hint };
        throw e;
      }
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    return res.json();
  },
};
