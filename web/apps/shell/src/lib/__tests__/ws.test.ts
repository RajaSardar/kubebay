import { beforeEach, describe, expect, it, vi } from "vitest";

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
