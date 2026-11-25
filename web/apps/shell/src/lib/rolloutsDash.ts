import { getToken } from "./api";

/**
 * Backlog 87: the Argo Rollouts dashboard shown inside the Rollouts page. The
 * engine finds and runs the user's own kubectl-argo-rollouts on this computer
 * and serves it through a same-origin proxy; this file is only the calls.
 */
export type DashState = "unavailable" | "not-installed" | "stopped" | "starting" | "running" | "failed";

export interface DashStatus {
  state: DashState;
  /** Same-origin proxy path of the running dashboard. */
  url?: string;
  /** The single namespace the running dashboard was started for; empty means all. */
  namespace?: string;
  /** Why the dashboard is off on this engine (state "unavailable"). */
  reason?: string;
  message?: string;
  stderrTail?: string;
  install?: { commands: string[]; releasesUrl: string };
}

/** The dashboard is heartbeated this often; the engine stops it after three silent minutes. */
export const HEARTBEAT_MS = 30_000;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Kubebay-Token": getToken() };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.text()).trim() || `${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const rolloutsDashApi = {
  status: (cluster: string) => call<DashStatus>("GET", `/api/rollouts-dashboard/status?cluster=${encodeURIComponent(cluster)}`),
  start: (cluster: string, namespaces?: string[]) => call<DashStatus>("POST", "/api/rollouts-dashboard/start", { cluster, namespaces }),
  /** Resolves false when the engine no longer has the dashboard (it was stopped or the engine restarted). */
  heartbeat: (cluster: string) => call<{ alive: boolean }>("POST", "/api/rollouts-dashboard/heartbeat", { cluster }).then((r) => r.alive),
  release: (cluster: string) => call<{ ok: boolean }>("POST", "/api/rollouts-dashboard/release", { cluster }),
};

/** The sandbox the frame runs under: scripts and forms, never the shell's origin. */
export const DASHBOARD_FRAME_SANDBOX = "allow-scripts allow-forms";

/** The tool is told a namespace only when exactly one is selected; otherwise it shows all. */
export function effectiveNamespace(namespaces?: string[]): string {
  return namespaces && namespaces.length === 1 ? (namespaces[0] ?? "") : "";
}
