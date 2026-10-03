import { describe, it, expect, vi, afterEach } from "vitest";
import { announceDisconnect, onRemoteDisconnect } from "./clusterChannel";

/** In-memory BroadcastChannel: delivers to every other instance with the same name, like the real one. */
class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public name: string) {
    FakeChannel.all.push(this);
  }
  postMessage(data: unknown) {
    for (const c of FakeChannel.all) {
      if (c !== this && !c.closed && c.name === this.name) c.onmessage?.({ data } as MessageEvent);
    }
  }
  close() {
    this.closed = true;
  }
}

afterEach(() => {
  FakeChannel.all = [];
  vi.unstubAllGlobals();
});

describe("cluster channel", () => {
  it("tells other windows which cluster was disconnected", () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const got: string[] = [];
    const stop = onRemoteDisconnect((id) => got.push(id));
    announceDisconnect("kind-dev");
    expect(got).toEqual(["kind-dev"]);
    stop();
    announceDisconnect("stage");
    expect(got).toEqual(["kind-dev"]);
  });

  it("ignores messages that are not disconnects", () => {
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    const got: string[] = [];
    onRemoteDisconnect((id) => got.push(id));
    new FakeChannel("kubebay-clusters").postMessage({ type: "other", id: "x" });
    new FakeChannel("kubebay-clusters").postMessage("junk");
    expect(got).toEqual([]);
  });

  it("is a no-op where BroadcastChannel does not exist", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    expect(() => announceDisconnect("kind-dev")).not.toThrow();
    expect(() => onRemoteDisconnect(() => {})()).not.toThrow();
  });
});
