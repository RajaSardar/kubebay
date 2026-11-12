import { beforeEach, describe, expect, it } from "vitest";
import { createShellSession, currentShell, setCurrentShell, type SessionDeps, type ShellPhase, type TermLike } from "../shellSession";
import type { ChanSpec, Handlers } from "../ws";

// ADR 0005: the dock's shell is owned by a module-level session, not by a
// component. The dock view only shows and hides it, so the shell, its channel
// and its scrollback outlive every navigation, and hiding it never resizes
// the program running in it.

function fakes() {
  const sent = {
    open: [] as ChanSpec[],
    close: [] as string[],
    resize: [] as [string, number, number][],
    input: [] as [string, string][],
  };
  let handlers: Handlers[] = [];
  const observers = new Map<HTMLElement, () => void>();
  const written: string[] = [];
  let onInput: (d: string) => void = () => {};
  let disposed = false;
  const element = document.createElement("div");

  const size = (el: HTMLElement) => ({ w: el.clientWidth, h: el.clientHeight });
  const term: TermLike = {
    element,
    write: (d) => written.push(typeof d === "string" ? d : new TextDecoder().decode(d)),
    paste: (t) => onInput(t),
    focus: () => {},
    fit: () => {},
    propose: () => {
      const host = element.parentElement;
      if (!host) return null;
      const { w, h } = size(host);
      return w && h ? { cols: Math.floor(w / 8), rows: Math.floor(h / 16) } : null;
    },
    onData: (cb) => {
      onInput = cb;
    },
    dispose: () => {
      disposed = true;
    },
  };
  const deps: SessionDeps = {
    makeTerm: () => term,
    observeSize: (host, cb) => {
      observers.set(host, cb);
      return () => observers.delete(host);
    },
    ws: {
      attach: (h) => {
        handlers.push(h);
        return () => {
          handlers = handlers.filter((x) => x !== h);
        };
      },
      openChannel: (c) => sent.open.push(c),
      closeChannel: (id) => sent.close.push(id),
      resizeChannel: (id, cols, rows) => sent.resize.push([id, cols, rows]),
      chanSend: (id, d) => sent.input.push([id, new TextDecoder().decode(d)]),
    },
  };
  const host = (w: number, h: number) => {
    const el = document.createElement("div");
    Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
    return el;
  };
  const resize = (el: HTMLElement, w: number, h: number) => {
    Object.defineProperty(el, "clientWidth", { configurable: true, value: w });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: h });
    observers.get(el)?.();
  };
  return {
    deps,
    sent,
    written,
    term,
    host,
    resize,
    type: (s: string) => onInput(s),
    status: (c: boolean) => handlers.forEach((h) => h.onStatus?.(c)),
    data: (id: string, s: string) => handlers.forEach((h) => h.onChanData?.(id, new TextEncoder().encode(s))),
    closed: (id: string, msg?: string) => handlers.forEach((h) => h.onChanClosed?.(id, msg)),
    isDisposed: () => disposed,
    listening: () => handlers.length,
  };
}

describe("a shell session", () => {
  let f: ReturnType<typeof fakes>;
  let phases: ShellPhase[];
  const start = () => createShellSession(f.deps, { cluster: "kind-dev", onPhase: (p) => phases.push(p) });

  beforeEach(() => {
    f = fakes();
    phases = [];
  });

  it("opens its channel when first shown, sized to where it's shown", () => {
    const s = start();
    expect(f.sent.open).toEqual([]);
    s.attach(f.host(800, 320));
    expect(f.sent.open).toEqual([{ id: s.channelId, kind: "local-shell", cluster: "kind-dev", cols: 100, rows: 20 }]);
    expect(phases).toEqual([{ at: "connecting" }]);
  });

  it("outlives being hidden and shown again, twenty times: the same channel, the same terminal, its scrollback", () => {
    const s = start();
    f.status(true);
    s.attach(f.host(800, 320));
    const id = s.channelId;
    f.data(id, "$ kubectl get pods\r\n");
    for (let i = 0; i < 20; i++) {
      s.detach();
      const next = f.host(800, 320);
      s.attach(next);
      expect(next.contains(f.term.element)).toBe(true);
    }
    expect(f.sent.close).toEqual([]);
    expect(f.sent.open).toHaveLength(1);
    expect(s.channelId).toBe(id);
    expect(f.written.join("")).toContain("kubectl get pods");
    expect(f.isDisposed()).toBe(false);
  });

  it("never fits or resizes a hidden host, and resizes once when shown at a new size", () => {
    const s = start();
    const h = f.host(800, 320);
    s.attach(h);
    f.resize(h, 0, 0);
    s.detach();
    f.resize(h, 0, 0);
    expect(f.sent.resize).toEqual([]);
    const shown = f.host(960, 480);
    s.attach(shown);
    f.resize(shown, 960, 480);
    expect(f.sent.resize).toEqual([[s.channelId, 120, 30]]);
  });

  it("goes live on its first output and ends when the shell exits", () => {
    const s = start();
    s.attach(f.host(800, 320));
    f.data(s.channelId, "$ ");
    f.data(s.channelId, "ls\r\n");
    f.closed(s.channelId, "exit code 0");
    expect(phases).toEqual([{ at: "connecting" }, { at: "live" }, { at: "ended", end: { kind: "exit", code: 0 } }]);
  });

  it("queues no keystrokes while the socket is down: the shell is lost, not waiting", () => {
    const s = start();
    f.status(true);
    s.attach(f.host(800, 320));
    f.type("l");
    expect(f.sent.input).toEqual([[s.channelId, "l"]]);
    f.status(false);
    expect(phases.at(-1)).toEqual({ at: "lost" });
    f.type("s\r");
    f.status(true);
    f.type("rm -rf\r");
    expect(f.sent.input).toEqual([[expect.any(String), "l"]]);
  });

  it("restarts on a new channel in the same terminal, and ends only when told", () => {
    const s = start();
    f.status(true);
    s.attach(f.host(800, 320));
    const first = s.channelId;
    s.restart();
    expect(f.sent.close).toEqual([first]);
    expect(f.sent.open).toHaveLength(2);
    expect(s.channelId).not.toBe(first);
    const second = s.channelId;
    s.end();
    expect(f.sent.close).toEqual([first, second]);
    expect(f.isDisposed()).toBe(true);
    expect(f.listening()).toBe(0);
  });
});

describe("the current shell", () => {
  it("is held at module level, outside any component", () => {
    const f = fakes();
    const s = createShellSession(f.deps, { cluster: "kind-dev", onPhase: () => {} });
    setCurrentShell(s);
    expect(currentShell()).toBe(s);
    setCurrentShell(null);
    expect(currentShell()).toBeNull();
  });
});
