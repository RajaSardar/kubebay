import { classifyShellEnd, type ShellEnd } from "./localshell";
import type { ChanSpec, Handlers } from "./ws";

// ADR 0005: the dock's local shell is owned by one module-level session, not
// by a component. The dock view only shows and hides it (attach / detach), so
// the shell, its channel and its scrollback outlive every navigation,
// /clusters and a page that throws. This module imports no xterm: the
// terminal comes in through `makeTerm`, so the app shell can import it
// without pulling xterm into the main chunk.

export type ShellPhase = { at: "connecting" } | { at: "live" } | { at: "ended"; end: ShellEnd } | { at: "lost" };

/** The terminal a session draws into. xtermTerm.ts makes the real one. */
export interface TermLike {
  /** Opened once; showing the session moves this element into the dock. */
  readonly element: HTMLElement;
  write(data: string | Uint8Array): void;
  /** Sends text as a paste (bracketed when the program asked for it). */
  paste(text: string): void;
  focus(): void;
  fit(): void;
  /** The size that fits where it is shown now, or null when that has no size. */
  propose(): { cols: number; rows: number } | null;
  onData(cb: (data: string) => void): void;
  dispose(): void;
}

export interface SessionDeps {
  makeTerm(): TermLike;
  /** Calls `cb` when `host` changes size; returns a function that stops it. */
  observeSize(host: HTMLElement, cb: () => void): () => void;
  ws: {
    attach(h: Handlers): () => void;
    openChannel(c: ChanSpec): void;
    closeChannel(id: string): void;
    resizeChannel(id: string, cols: number, rows: number): void;
    chanSend(id: string, data: Uint8Array): void;
  };
}

export interface SessionOptions {
  /** The cluster whose kubeconfig context the shell is bound to. */
  cluster: string;
  onPhase(p: ShellPhase): void;
  /** Runs once, before the first channel opens. */
  onSetup?(s: ShellSession): void;
  /** Output has already been written to the terminal; this is a notification. */
  onData?(data: Uint8Array, s: ShellSession): void;
}

export interface ShellSession {
  readonly cluster: string;
  /** The channel open now, or "" between sessions. */
  readonly channelId: string;
  /** Shows the terminal in `host`. The first time, it opens the shell. */
  attach(host: HTMLElement): void;
  /** Takes the terminal out of the page. The shell keeps running. */
  detach(): void;
  focus(): void;
  /** Whether keyboard focus is in the terminal. */
  hasFocus(): boolean;
  write(data: string): void;
  paste(text: string): void;
  /** Ends the shell and starts a new one in the same terminal. */
  restart(): void;
  /** Ends the shell and disposes the terminal. */
  end(): void;
}

export function createShellSession(deps: SessionDeps, opts: SessionOptions): ShellSession {
  const term = deps.makeTerm();
  let channelId = "";
  let connected = false;
  let phase: ShellPhase["at"] = "connecting";
  let host: HTMLElement | null = null;
  let unobserve: () => void = () => {};
  let started = false;
  let lastSize = "";

  const report = (p: ShellPhase) => {
    phase = p.at;
    opts.onPhase(p);
  };

  /** The size to tell the shell, or null when the terminal isn't shown at a real size. */
  const shownSize = () => {
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return null;
    term.fit();
    const dm = term.propose();
    return dm && dm.cols > 2 && dm.rows > 2 ? dm : null;
  };

  const open = () => {
    if (channelId) deps.ws.closeChannel(channelId);
    channelId = `lsh-${Math.random().toString(36).slice(2, 10)}`;
    const size = shownSize() ?? { cols: 80, rows: 24 };
    lastSize = `${size.cols}x${size.rows}`;
    report({ at: "connecting" });
    deps.ws.openChannel({ id: channelId, kind: "local-shell", cluster: opts.cluster, cols: size.cols, rows: size.rows });
  };

  const onResize = () => {
    const size = shownSize();
    if (!size || !channelId) return;
    const key = `${size.cols}x${size.rows}`;
    if (key === lastSize) return;
    lastSize = key;
    deps.ws.resizeChannel(channelId, size.cols, size.rows);
  };

  const detachWs = deps.ws.attach({
    onChanData: (id, data) => {
      if (id !== channelId) return;
      term.write(data);
      if (phase !== "live") report({ at: "live" });
      opts.onData?.(data, session);
    },
    onChanClosed: (id, message) => {
      if (id !== channelId) return;
      channelId = "";
      report({ at: "ended", end: classifyShellEnd(message) });
    },
    // A build without the feature answers chan-open with an error frame and
    // no chan-closed; left alone, the terminal would sit blank forever.
    onError: (id, message) => {
      if (id !== channelId) return;
      channelId = "";
      report({ at: "ended", end: classifyShellEnd(message) });
    },
    onStatus: (up) => {
      connected = up;
      // ws.ts replays watches across a reconnect but not channels: a dropped
      // socket is a dead shell. Forget the channel, so nothing typed now is
      // queued and run in some later shell.
      if (!up && channelId) {
        channelId = "";
        report({ at: "lost" });
      }
    },
  });

  term.onData((d) => {
    if (connected && channelId) deps.ws.chanSend(channelId, new TextEncoder().encode(d));
  });

  const session: ShellSession = {
    cluster: opts.cluster,
    get channelId() {
      return channelId;
    },
    attach(next) {
      if (host === next) return;
      session.detach();
      host = next;
      next.appendChild(term.element);
      unobserve = deps.observeSize(next, onResize);
      if (!started) {
        started = true;
        opts.onSetup?.(session);
        open();
      } else {
        onResize();
      }
    },
    detach() {
      unobserve();
      unobserve = () => {};
      term.element.remove();
      host = null;
    },
    focus: () => term.focus(),
    hasFocus: () => term.element.contains(document.activeElement),
    write: (data) => term.write(data),
    paste: (text) => term.paste(text),
    restart() {
      open();
    },
    end() {
      session.detach();
      if (channelId) deps.ws.closeChannel(channelId);
      channelId = "";
      detachWs();
      term.dispose();
    },
  };
  return session;
}

let current: ShellSession | null = null;

/** The dock's shell, if one is open. It lives here, not in any component. */
export function currentShell(): ShellSession | null {
  return current;
}

export function setCurrentShell(s: ShellSession | null): void {
  current = s;
}
