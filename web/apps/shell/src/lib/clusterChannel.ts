/**
 * Cross-window cluster events. Disconnecting in one window must stop the
 * others' streams too: their open subscriptions would otherwise reconnect
 * the cluster the moment the engine dropped it.
 */
const NAME = "kubebay-clusters";

interface DisconnectMsg {
  type: "disconnect";
  id: string;
}

function channel(): BroadcastChannel | null {
  return typeof BroadcastChannel === "function" ? new BroadcastChannel(NAME) : null;
}

export function announceDisconnect(id: string): void {
  const ch = channel();
  if (!ch) return;
  ch.postMessage({ type: "disconnect", id } satisfies DisconnectMsg);
  ch.close();
}

export function onRemoteDisconnect(handler: (id: string) => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  ch.onmessage = (e: MessageEvent) => {
    const m = e.data as Partial<DisconnectMsg> | null;
    if (m && typeof m === "object" && m.type === "disconnect" && typeof m.id === "string") handler(m.id);
  };
  return () => ch.close();
}
