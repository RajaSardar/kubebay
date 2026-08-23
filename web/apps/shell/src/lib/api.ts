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

export const api = {
  health: () => get<{ ok: boolean }>("/api/healthz"),
  clusters: () => get<ClusterInfo[]>("/api/clusters"),
};
