import { describe, expect, it } from "vitest";
import { drawerChord } from "../drawerKeys";

// ADR 0005: the drawer's chords (⌘⇧Enter pops out, ⌘⇧S splits) belong to
// the page, not to whatever you're typing in. In a field, an editor or the
// terminal dock they do nothing, so the dock never pops a drawer out.

function keyIn(target: Element, init: KeyboardEventInit) {
  const e = new KeyboardEvent("keydown", { bubbles: true, ...init });
  Object.defineProperty(e, "target", { value: target });
  return e;
}

describe("drawerChord", () => {
  const page = document.createElement("button");
  const xterm = document.createElement("div");
  xterm.className = "xterm";
  const shellInput = xterm.appendChild(document.createElement("textarea"));
  const field = document.createElement("input");

  it("pops out on ⌘⇧Enter and splits on ⌘⇧S, from the page", () => {
    expect(drawerChord(keyIn(page, { key: "Enter", metaKey: true, shiftKey: true }))).toBe("pop-out");
    expect(drawerChord(keyIn(page, { key: "S", ctrlKey: true, shiftKey: true }))).toBe("split");
    expect(drawerChord(keyIn(page, { key: "S", ctrlKey: true }))).toBeNull();
  });

  it("does nothing while typing in a field or the terminal", () => {
    expect(drawerChord(keyIn(shellInput, { key: "Enter", metaKey: true, shiftKey: true }))).toBeNull();
    expect(drawerChord(keyIn(shellInput, { key: "S", metaKey: true, shiftKey: true }))).toBeNull();
    expect(drawerChord(keyIn(field, { key: "S", metaKey: true, shiftKey: true }))).toBeNull();
  });
});
