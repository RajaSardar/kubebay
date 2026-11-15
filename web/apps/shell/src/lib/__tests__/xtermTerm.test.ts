import { beforeEach, describe, expect, it, vi } from "vitest";

// ADR 0005: the real terminal behind the dock's session. xterm can open only
// once, and only into an element in the page, so it opens the first time the
// dock shows it; keys the dock and the drawers own never reach the shell.

const made = vi.hoisted(() => ({ terms: [] as FakeTerm[], propose: { cols: 100, rows: 20 } as { cols: number; rows: number } | undefined }));

class FakeTerm {
  open = vi.fn();
  write = vi.fn();
  paste = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  loadAddon = vi.fn();
  onData = vi.fn();
  options: Record<string, unknown> = {};
  keyHandler: (e: KeyboardEvent) => boolean = () => true;
  attachCustomKeyEventHandler = (h: (e: KeyboardEvent) => boolean) => {
    this.keyHandler = h;
  };
  constructor() {
    made.terms.push(this);
  }
}

vi.mock("@xterm/xterm", () => ({ Terminal: FakeTerm }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    proposeDimensions = () => made.propose;
  },
}));

const { makeXtermTerm } = await import("../xtermTerm");

describe("makeXtermTerm", () => {
  beforeEach(() => {
    made.terms.length = 0;
    made.propose = { cols: 100, rows: 20 };
  });

  it("opens xterm once, the first time it's fitted in the page", () => {
    const t = makeXtermTerm();
    t.fit();
    expect(made.terms[0]!.open).not.toHaveBeenCalled();
    document.body.appendChild(t.element);
    t.fit();
    t.fit();
    expect(made.terms[0]!.open).toHaveBeenCalledTimes(1);
    expect(made.terms[0]!.open).toHaveBeenCalledWith(t.element);
    t.element.remove();
  });

  it("proposes nothing when it can't be sized", () => {
    const t = makeXtermTerm();
    expect(t.propose()).toEqual({ cols: 100, rows: 20 });
    made.propose = undefined;
    expect(t.propose()).toBeNull();
  });

  it("keeps the dock's toggle and the drawer chords out of the shell", () => {
    makeXtermTerm();
    const handler = made.terms[0]!.keyHandler;
    expect(handler(new KeyboardEvent("keydown", { code: "Backquote", key: "`", ctrlKey: true }))).toBe(false);
    expect(handler(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, shiftKey: true }))).toBe(false);
    expect(handler(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))).toBe(true);
  });
});
