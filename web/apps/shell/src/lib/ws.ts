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

export interface ChanSpec {
  id: string;
  kind: "logs" | "exec";
  cluster: string;
  namespace: string;
  pod: string;
  container?: string;
  tail?: number;
  follow?: boolean;
  previous?: boolean;
  command?: string[];
  cols?: number;
  rows?: number;
}

export interface Handlers {
  onBegin?: (id: string) => void;
  onItems?: (id: string, ops: Op[]) => void;
  onDelta?: (id: string, ops: Op[]) => void;
  onSync?: (id: string) => void;
  onAck?: (id: string, message?: string) => void;
  onError?: (message: string) => void;
  onChanData?: (id: string, data: Uint8Array) => void;
  onChanClosed?: (id: string, message?: string) => void;
  onStatus?: (connected: boolean) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

class MultiplexedStream {
  private ws: WebSocket | null = null;
  private subs = new Map<string, SubSpec>();
  private retry = 0;
  private closedByUser = false;
  private listeners = new Set<Handlers>();
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.connect();
  }

  private dispatch(fn: (h: Handlers) => void) {
    for (const h of this.listeners) fn(h);
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.dispatch((h) => h.onStatus?.(true));
      for (const spec of this.subs.values()) this.sendSub(spec);
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
            this.dispatch((h) => h.onError?.(f.message ?? "unknown error"));
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
      this.dispatch((h) => h.onStatus?.(false));
      if (this.closedByUser) return;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.retry);
      this.retry += 1;
      setTimeout(() => this.connect(), delay);
    };
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
    this.ws?.send(JSON.stringify({ type: "unsub", id }));
  }

  openChannel(c: ChanSpec) {
    this.ws?.send(
      JSON.stringify({
        type: "chan-open",
        id: c.id,
        kind: c.kind,
        cluster: c.cluster,
        namespace: c.namespace,
        pod: c.pod,
        container: c.container,
        tail: c.tail,
        follow: c.follow,
        previous: c.previous,
        command: c.command,
        cols: c.cols,
        rows: c.rows,
      }),
    );
  }

  closeChannel(id: string) {
    this.ws?.send(JSON.stringify({ type: "chan-close", id }));
  }

  resizeChannel(id: string, cols: number, rows: number) {
    this.ws?.send(JSON.stringify({ type: "chan-resize", id, cols, rows }));
  }

  chanSend(id: string, data: Uint8Array) {
    const out = new Uint8Array(4 + id.length + data.length);
    new DataView(out.buffer).setUint32(0, id.length);
    out.set(new TextEncoder().encode(id), 4);
    out.set(data, 4 + id.length);
    this.ws?.send(out);
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
