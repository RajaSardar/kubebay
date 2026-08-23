import { decode } from "@msgpack/msgpack";

export interface Op {
  op: string;
  key: string;
  obj?: Record<string, unknown>;
}

interface DataFrame {
  type: "begin" | "items" | "delta";
  id: string;
  rv?: string;
  ops?: Op[];
}

interface ControlFrame {
  type: "ack" | "error" | "sync" | "pong";
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

export interface StreamHandlers {
  onBegin?: (id: string) => void;
  onItems?: (id: string, ops: Op[]) => void;
  onDelta?: (id: string, ops: Op[]) => void;
  onSync?: (id: string) => void;
  onError?: (message: string) => void;
  onStatus?: (connected: boolean) => void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

export class KubebayStream {
  private ws: WebSocket | null = null;
  private handlers: StreamHandlers;
  private subs = new Map<string, SubSpec>();
  private closedByUser = false;
  private retry = 0;
  private token: string;

  constructor(token: string, handlers: StreamHandlers) {
    this.token = token;
    this.handlers = handlers;
    this.connect();
  }

  private connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus?.(true);
      for (const spec of this.subs.values()) this.sendSub(spec);
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        let f: ControlFrame;
        try {
          f = JSON.parse(ev.data) as ControlFrame;
        } catch {
          return;
        }
        switch (f.type) {
          case "sync":
            this.handlers.onSync?.(f.id ?? "");
            break;
          case "error":
            this.handlers.onError?.(f.message ?? "unknown error");
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
        if (frame.type === "begin") this.handlers.onBegin?.(frame.id);
        else if (frame.type === "items") this.handlers.onItems?.(frame.id, ops);
        else if (frame.type === "delta") this.handlers.onDelta?.(frame.id, ops);
      });
    };

    ws.onclose = () => {
      this.handlers.onStatus?.(false);
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

  subscribe(spec: SubSpec) {
    this.subs.set(spec.id, spec);
    if (this.ws?.readyState === WebSocket.OPEN) this.sendSub(spec);
  }

  unsubscribe(id: string) {
    if (!this.subs.delete(id)) return;
    this.ws?.send(JSON.stringify({ type: "unsub", id }));
  }

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
