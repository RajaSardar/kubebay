import { beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "@msgpack/msgpack";

type Payload = string | Uint8Array;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: Payload[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(
    readonly url: string,
    readonly protocols?: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }

  // Matches the browser: sending on a CONNECTING socket throws.
  send(payload: Payload) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error("InvalidStateError");
    this.sent.push(payload);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
  }

  /** Test helper: complete the handshake. */
  accept() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
}

async function freshWs() {
  vi.resetModules();
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  const mod = await import("../ws");
  // The stream is a lazy singleton; attaching builds it and its socket.
  mod.attach({});
  const socket = () => {
    const ws = FakeWebSocket.instances[0];
    if (!ws) throw new Error("no socket was created");
    return ws;
  };
  return { mod, socket };
}

const chan = {
  id: "logs-1",
  kind: "logs" as const,
  cluster: "kind",
  namespace: "default",
  pod: "nginx",
};

beforeEach(() => {
  vi.useRealTimers();
});

describe("openChannel before the socket is open", () => {
  it("queues instead of throwing, then flushes on open", async () => {
    const { mod, socket } = await freshWs();

    expect(socket().readyState).toBe(FakeWebSocket.CONNECTING);
    expect(() => mod.openChannel(chan)).not.toThrow();
    expect(socket().sent).toHaveLength(0);

    socket().accept();

    const frames = socket().sent.map((p) => JSON.parse(p as string));
    expect(frames).toContainEqual(expect.objectContaining({ type: "chan-open", id: "logs-1" }));
  });

  it("sends straight through once open", async () => {
    const { mod, socket } = await freshWs();
    socket().accept();
    mod.openChannel(chan);
    expect(socket().sent).toHaveLength(1);
  });
});

describe("chan-open frames per kind", () => {
  it("omits pod coordinates for a local shell", async () => {
    const { mod, socket } = await freshWs();
    socket().accept();
    mod.openChannel({ id: "lsh-1", kind: "local-shell", cluster: "kind", cols: 100, rows: 30 });

    const frame = JSON.parse(socket().sent[0] as string);
    expect(frame).toEqual({
      type: "chan-open",
      id: "lsh-1",
      kind: "local-shell",
      cluster: "kind",
      cols: 100,
      rows: 30,
    });
    // The engine resolves the shell itself and ignores a client command; the
    // frame must not imply otherwise by carrying one.
    expect(frame).not.toHaveProperty("command");
  });

  it("carries the command only for exec and the tail only for logs", async () => {
    const { mod, socket } = await freshWs();
    socket().accept();
    mod.openChannel({
      id: "exec-1",
      kind: "exec",
      cluster: "kind",
      namespace: "default",
      pod: "nginx",
      command: ["sh"],
    });
    mod.openChannel({ ...chan, tail: 100, follow: true });

    const [execFrame, logsFrame] = socket().sent.map((p) => JSON.parse(p as string));
    expect(execFrame.command).toEqual(["sh"]);
    expect(execFrame).not.toHaveProperty("tail");
    expect(logsFrame).toMatchObject({ pod: "nginx", tail: 100, follow: true });
    expect(logsFrame).not.toHaveProperty("command");
  });
});

describe("error frames", () => {
  it("carry the id of the channel that caused them", async () => {
    const { mod, socket } = await freshWs();
    socket().accept();

    const onError = vi.fn();
    mod.attach({ onError });
    socket().onmessage?.({ data: JSON.stringify({ type: "error", id: "logs-1", message: "boom" }) });

    expect(onError).toHaveBeenCalledWith("logs-1", "boom");
  });

  it("report an empty id when the server could not attribute the error", async () => {
    const { mod, socket } = await freshWs();
    socket().accept();

    const onError = vi.fn();
    mod.attach({ onError });
    socket().onmessage?.({ data: JSON.stringify({ type: "error", message: "bad frame" }) });

    expect(onError).toHaveBeenCalledWith("", "bad frame");
  });
});

describe("frame order", () => {
  // Binary frames (begin/items/delta) and text frames (sync) must reach the
  // handlers in the order the server sent them. Decoding binary frames
  // asynchronously let "sync" overtake its own "begin"/"items": the table was
  // marked synced before its rows arrived, then reset by the late "begin", and
  // sat on its skeleton forever.
  const bin = (frame: object) => {
    const u8 = encode(frame);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  };

  it("asks for binary frames as ArrayBuffers", async () => {
    const { socket } = await freshWs();
    expect((socket() as unknown as { binaryType?: string }).binaryType).toBe("arraybuffer");
  });

  it("delivers begin, items and sync in the order they arrived", async () => {
    const { mod, socket } = await freshWs();
    const seen: string[] = [];
    mod.attach({
      onBegin: (id) => seen.push(`begin:${id}`),
      onItems: (id, ops) => seen.push(`items:${id}:${ops.length}`),
      onSync: (id) => seen.push(`sync:${id}`),
    });
    socket().accept();
    socket().onmessage?.({ data: bin({ type: "begin", id: "ui-1" }) });
    socket().onmessage?.({ data: bin({ type: "items", id: "ui-1", ops: [{ op: "u", key: "a", obj: {} }] }) });
    socket().onmessage?.({ data: JSON.stringify({ type: "sync", id: "ui-1" }) });
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["begin:ui-1", "items:ui-1:1", "sync:ui-1"]);
  });

  it("keeps the order even if a frame arrives as a Blob", async () => {
    const { mod, socket } = await freshWs();
    const seen: string[] = [];
    mod.attach({ onBegin: (id) => seen.push(`begin:${id}`), onSync: (id) => seen.push(`sync:${id}`) });
    socket().accept();
    socket().onmessage?.({ data: new Blob([bin({ type: "begin", id: "ui-2" })]) });
    socket().onmessage?.({ data: JSON.stringify({ type: "sync", id: "ui-2" }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual(["begin:ui-2", "sync:ui-2"]);
  });
});

describe("a listener attached after the socket opened", () => {
  // Without this, a table mounted after the socket was already up never
  // learned it was connected: its "live" pill never showed and pod metrics
  // (enabled only when connected) never loaded.
  it("is told straight away that the stream is connected", async () => {
    const { mod, socket } = await freshWs();
    socket().accept();
    const onStatus = vi.fn();
    mod.attach({ onStatus });
    expect(onStatus).toHaveBeenCalledWith(true, expect.any(Number), 0);
  });

  it("is not told anything while the socket is still connecting", async () => {
    const { mod } = await freshWs();
    const onStatus = vi.fn();
    mod.attach({ onStatus });
    expect(onStatus).not.toHaveBeenCalled();
  });
});

describe("engine-ended subscriptions", () => {
  const spec = { id: "pods-1", cluster: "kind", gvr: "v1/pods", ns: ["default"], mode: "metadata" as const };
  const errorFrame = (id: string, message: string) => JSON.stringify({ type: "error", id, message });

  it("resyncs a stream the engine ended because the cluster's credentials changed", async () => {
    const { mod, socket } = await freshWs();
    const onError = vi.fn();
    mod.attach({ onError });
    socket().accept();
    mod.subscribe(spec);
    socket().sent = [];

    socket().onmessage?.({ data: errorFrame("pods-1", "cluster credentials changed") });

    expect(socket().sent.map((p) => JSON.parse(p as string))).toEqual([
      { type: "resync", id: "pods-1", cluster: "kind", gvr: "v1/pods", ns: ["default"], mode: "metadata" },
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("still reports a disconnect, and does not resync a stream nobody holds", async () => {
    const { mod, socket } = await freshWs();
    const onError = vi.fn();
    mod.attach({ onError });
    socket().accept();
    mod.subscribe(spec);
    socket().sent = [];

    socket().onmessage?.({ data: errorFrame("pods-1", "cluster disconnected") });
    socket().onmessage?.({ data: errorFrame("gone-1", "cluster credentials changed") });

    expect(socket().sent).toHaveLength(0);
    expect(onError).toHaveBeenCalledWith("pods-1", "cluster disconnected");
    expect(onError).toHaveBeenCalledWith("gone-1", "cluster credentials changed");
  });
});
