import { useQuery } from "@tanstack/react-query";

/**
 * KB-04: the desktop app's updater, as its commands report it
 * (desktop/src-tauri/src/updater.rs). A browser tab has no updater.
 */
export type UpdateState =
  | { state: "unavailable" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | { state: "ready"; version: string; notes: string | null }
  | { state: "homebrew"; version: string }
  | { state: "manual" }
  | { state: "failed"; error: string; checkedAt: number };

export type UpdateStatus = UpdateState & { currentVersion: string; autoCheck: boolean };

/** The one address the updater fetches, shown in Settings. */
export const UPDATE_ENDPOINT = "https://github.com/RajaSardar/kubebay/releases/latest/download/latest.json";
export const RELEASES_URL = "https://github.com/RajaSardar/kubebay/releases";

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

function ipc(): Invoke | null {
  return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__?.invoke ?? null;
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const invoke = ipc();
  if (!invoke) throw new Error("Updates are only available in the desktop app.");
  try {
    return (await invoke(cmd, args)) as T;
  } catch (e) {
    // Commands reject with the Rust error string.
    throw new Error(e instanceof Error ? e.message : String(e));
  }
}

export const updatesApi = {
  available: () => ipc() !== null,
  /** The updater's state, or null in a browser tab. */
  status: (): Promise<UpdateStatus | null> => (ipc() ? call<UpdateStatus>("update_status") : Promise.resolve(null)),
  setChecks: (enabled: boolean) => call<UpdateStatus>("set_update_checks", { enabled }),
  checkNow: () => call<UpdateStatus>("check_for_updates"),
  /** Installs the downloaded update and restarts; rejects with why it didn't. */
  install: () => call<void>("install_update"),
};

/** The updater's state, re-read every 10 minutes. Null in a browser tab. */
export function useUpdateStatus() {
  return useQuery({
    queryKey: ["updates"],
    queryFn: updatesApi.status,
    enabled: updatesApi.available(),
    refetchInterval: 10 * 60_000,
  });
}
