import type { IssueNotification } from "./issueNotifications";

/**
 * Backlog 85: the desktop app's two notification commands
 * (desktop/src-tauri/src/main.rs). The page may call only these, and `send`
 * passes nothing but a title and a body. A browser tab has no notifications and
 * every call is a no-op.
 */
export type NotifyPermission = "granted" | "denied" | "unavailable";

type Invoke = (cmd: string, args?: unknown) => Promise<unknown>;

function ipc(): Invoke | null {
  return (window as unknown as { __TAURI_INTERNALS__?: { invoke?: Invoke } }).__TAURI_INTERNALS__?.invoke ?? null;
}

export const desktopNotify = {
  available: () => ipc() !== null,
  /** Triggers the OS permission prompt the first time; "denied" when the user (or the OS settings) said no. */
  async requestPermission(): Promise<NotifyPermission> {
    const invoke = ipc();
    if (!invoke) return "unavailable";
    try {
      return (await invoke("request_notification_permission")) === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  },
  async send(n: IssueNotification): Promise<void> {
    const invoke = ipc();
    if (!invoke) return;
    try {
      await invoke("notify_issue", { title: n.title, body: n.body });
    } catch {
      /* a notification that cannot be shown is not worth an error */
    }
  },
};
