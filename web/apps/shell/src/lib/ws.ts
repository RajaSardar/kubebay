import { decode } from "@msgpack/msgpack";
import { getToken } from "./api";

export interface Op {
  op: string;
  key: string;
  obj?: Record<string, unknown>;
}

interface DataFrame {
  type: "begin" | "items" | "delta" | "chan-data";
  id: string;
  rv?: string;
  ops?: Op[];
  data?: Uint8Array;
}

interface ControlFrame {
  type: "ack" | "error" | "sync" | "pong" | "chan-closed";
  id?: string;
  message?: string;
}

export interface SubSpec {
  id: string;
  cluster: string;
  gvr: string;
  ns?: string[];
  labelSelector?: string;
  mode?: "metadata" | "full";
}

interface ChanBase {
  id: string;
  cluster: string;
  cols?: number;
  rows?: number;
}

interface PodChanBase extends ChanBase {
  namespace: string;
  pod: string;
  container?: string;
}

export interface LogsChanSpec extends PodChanBase {
  kind: "logs";
  tail?: number;
  follow?: boolean;
  previous?: boolean;
}

export interface ExecChanSpec extends PodChanBase {
  kind: "exec";
  command?: string[];
}

/**
 * A PTY on the machine hosting the engine. It binds to a kubeconfig context,
 * never to a pod, and the engine resolves the shell itself — so this variant
 * carries neither pod coordinates nor a command, and the union makes passing
 * one a type error rather than a field the server quietly ignores.
 */
export interface LocalShellChanSpec extends ChanBase {
  kind: "local-shell";
}

export type ChanSpec = LogsChanSpec | ExecChanSpec | LocalShellChanSpec;

export interface Handlers {
  onBegin?: (id: string) => void;
  onItems?: (id: string, ops: Op[]) => void;
  onDelta?: (id: string, ops: Op[]) => void;
  onSync?: (id: string) => void;
  onAck?: (id: string, message?: string) => void;
  /** id is the subscription/channel the error belongs to; "" if the server could not tell. */
  onError?: (id: string, message: string) => void;
  onChanData?: (id: string, data: Uint8Array) => void;
  onChanClosed?: (id: string, message?: string) => void;
  /** connected=true on open; false on close with retry attempt + next-retry ms */
  onStatus?: (connected: boolean, retryAttempt?: number, nextRetryMs?: number) => void;
}

// Must match WSTokenSubprotocolPrefix in engine/internal/httpapi/server.go.
const WS_TOKEN_SUBPROTOCOL_PREFIX = "kubebay.token.";

const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 30_000;
// How long a connection must stay open before we consider it "stable"
// and reset the retry counter. Prevents ALB-killed flaps from resetting retry=0.
const STABLE_MS = 5_000;
// Send an app-level ping every 20s as belt-and-suspenders keepalive.
const PING_INTERVAL_MS = 20_000;
// Cap on frames held while the socket is not open.
const MAX_QUEUED_FRAMES = 256;

class MultiplexedStream {
  private ws: WebSocket | null = null;
  private subs = new Map<string, SubSpec>();
  private retry = 0;
  private closedByUser = false;
  private listeners = new Set<Handlers>();
  private token: string;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  // Frames asked for before the socket was OPEN. send() on a CONNECTING socket
  // throws InvalidStateError, which is exactly what happens when a deep link
  // lands straight on a pod terminal: the channel is opened in the same tick
  // the socket is created. Queue instead and flush on open.
  private queue: (string | Uint8Array)[] = [];

  constructor(token: string) {
    this.token = token;
    this.connect();
  }

  private dispatch(fn: (h: Handlers) => void) {
    for (const h of this.listeners) fn(h);
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // The token rides in Sec-WebSocket-Protocol, the only client-settable
    // header a browser WebSocket has. A query string would land in history,
    // referrers and every proxy access log. With OIDC there is no token and the
    // session cookie authenticates instead, so offer no subprotocol at all.
    const subprotocols = this.token ? [`${WS_TOKEN_SUBPROTOCOL_PREFIX}${this.token}`] : [];
    const ws = new WebSocket(`${proto}://${location.host}/ws`, subprotocols);
    this.ws = ws;

    ws.onopen = () => {
      // Notify UI we're connected (but keep current retry count until stable)
      this.dispatch((h) => h.onStatus?.(true, this.retry, 0));
      for (const spec of this.subs.values()) this.sendSub(spec);
      const queued = this.queue;
      this.queue = [];
      for (const payload of queued) ws.send(payload);

      // Only reset retry count after connection is stable for STABLE_MS.
      // This prevents flapping (ALB kills new connection immediately) from
      // resetting the retry counter and showing "Attempt 0 · retrying in 1s".
      this.stableTimer = setTimeout(() => {
        this.retry = 0;
        this.dispatch((h) => h.onStatus?.(true, 0, 0));
      }, STABLE_MS);

      // Belt-and-suspenders: send app-level pings to keep ALB alive.
      // Server also sends WS protocol PINGs every 25s; browser auto-PONGs those.
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: "ping", id: "ka" }));
        }
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        let f: ControlFrame;
        try {
          f = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (f.type) {
          case "sync":
            this.dispatch((h) => h.onSync?.(f.id ?? ""));
            break;
          case "error":
            this.dispatch((h) => h.onError?.(f.id ?? "", f.message ?? "unknown error"));
            break;
          case "ack":
            this.dispatch((h) => h.onAck?.(f.id ?? "", f.message));
            break;
          case "chan-closed":
            this.dispatch((h) => h.onChanClosed?.(f.id ?? "", f.message));
            break;
        }
        return;
      }
      ev.data.arrayBuffer().then((buf: ArrayBuffer) => {
        let frame: DataFrame;
        try {
          frame = decode(buf) as DataFrame;
        } catch {
          return;
        }
        const ops = frame.ops ?? [];
        switch (frame.type) {
          case "begin":
            this.dispatch((h) => h.onBegin?.(frame.id));
            break;
          case "items":
            this.dispatch((h) => h.onItems?.(frame.id, ops));
            break;
          case "delta":
            this.dispatch((h) => h.onDelta?.(frame.id, ops));
            break;
          case "chan-data":
            if (frame.data) {
              const bytes = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data);
              this.dispatch((h) => h.onChanData?.(frame.id, bytes));
            }
            break;
        }
      });
    };

    ws.onclose = () => {
      if (this.closedByUser) return;
      // Clear keepalive timers
      if (this.stableTimer) { clearTimeout(this.stableTimer); this.stableTimer = null; }
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
      // Cap exponent so backoff doesn't overflow; max is RECONNECT_MAX_MS
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(this.retry, 12));
      this.dispatch((h) => h.onStatus?.(false, this.retry, delay));
      this.retry += 1;
      setTimeout(() => this.connect(), delay);
    };
  }

  /** Sends now if the socket is open, otherwise queues until it is. */
  private send(payload: string | Uint8Array) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
      return;
    }
    // Bounded so a long outage can't grow the queue without limit.
    if (this.queue.length >= MAX_QUEUED_FRAMES) this.queue.shift();
    this.queue.push(payload);
  }

  private sendSub(spec: SubSpec) {
    this.ws?.send(
      JSON.stringify({
        type: "sub",
        id: spec.id,
        cluster: spec.cluster,
        gvr: spec.gvr,
        ns: spec.ns,
        labelSelector: spec.labelSelector,
        mode: spec.mode,
      }),
    );
  }

  attach(h: Handlers): () => void {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }

  subscribe(spec: SubSpec) {
    this.subs.set(spec.id, spec);
    if (this.ws?.readyState === WebSocket.OPEN) this.sendSub(spec);
  }

  unsubscribe(id: string) {
    if (!this.subs.delete(id)) return;
    // Not queued: a sub that was never sent has nothing to cancel, and the
    // reconnect replay only walks this.subs, which no longer holds it.
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "unsub", id }));
  }

  openChannel(c: ChanSpec) {
    const frame: Record<string, unknown> = {
      type: "chan-open",
      id: c.id,
      kind: c.kind,
      cluster: c.cluster,
      cols: c.cols,
      rows: c.rows,
    };
    if (c.kind !== "local-shell") {
      frame.namespace = c.namespace;
      frame.pod = c.pod;
      frame.container = c.container;
    }
    if (c.kind === "logs") {
      frame.tail = c.tail;
      frame.follow = c.follow;
      frame.previous = c.previous;
    }
    if (c.kind === "exec") frame.command = c.command;
    this.send(JSON.stringify(frame));
  }

  closeChannel(id: string) {
    this.send(JSON.stringify({ type: "chan-close", id }));
  }

  resizeChannel(id: string, cols: number, rows: number) {
    this.send(JSON.stringify({ type: "chan-resize", id, cols, rows }));
  }

  chanSend(id: string, data: Uint8Array) {
    const out = new Uint8Array(4 + id.length + data.length);
    new DataView(out.buffer).setUint32(0, id.length);
    out.set(new TextEncoder().encode(id), 4);
    out.set(data, 4 + id.length);
    this.send(out);
  }
}

let singleton: MultiplexedStream | null = null;

function s(): MultiplexedStream {
  if (!singleton) singleton = new MultiplexedStream(getToken());
  return singleton;
}

export function attach(h: Handlers): () => void {
  return s().attach(h);
}
export function subscribe(spec: SubSpec) {
  s().subscribe(spec);
}
export function unsubscribe(id: string) {
  s().unsubscribe(id);
}
export function openChannel(c: ChanSpec) {
  s().openChannel(c);
}
export function closeChannel(id: string) {
  s().closeChannel(id);
}
export function resizeChannel(id: string, cols: number, rows: number) {
  s().resizeChannel(id, cols, rows);
}
export function chanSend(id: string, data: Uint8Array) {
  s().chanSend(id, data);
}
