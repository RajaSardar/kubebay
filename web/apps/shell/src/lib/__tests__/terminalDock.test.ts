import { beforeEach, describe, expect, it } from "vitest";
import { DOCK_HEIGHT_KEY, dockBounds, dockKeyAction, isDockToggle, isShellReservedKey, readDockHeight, useTerminalDock } from "../terminalDock";

// ADR 0005: the dock's state, kept apart from xterm so the app shell can read
// it without loading a terminal. The height is kept on this machine; whether
// the dock is open, and the shell, are not.

describe("dockBounds", () => {
  it("defaults to 300 px or 35% of the window, whichever is less, between 120 px and the window less 240 px", () => {
    expect(dockBounds(1000)).toEqual({ min: 120, max: 760, initial: 300 });
    expect(dockBounds(600)).toEqual({ min: 120, max: 360, initial: 210 });
    expect(dockBounds(300).max).toBe(120);
  });
});

describe("readDockHeight", () => {
  beforeEach(() => localStorage.clear());

  it("is the kept height, held to the window's bounds", () => {
    localStorage.setItem(DOCK_HEIGHT_KEY, "420");
    expect(readDockHeight(1000)).toBe(420);
    localStorage.setItem(DOCK_HEIGHT_KEY, "5000");
    expect(readDockHeight(1000)).toBe(760);
  });

  it("is the default when nothing usable is kept", () => {
    expect(readDockHeight(1000)).toBe(300);
    localStorage.setItem(DOCK_HEIGHT_KEY, "tall");
    expect(readDockHeight(1000)).toBe(300);
  });
});

describe("dockKeyAction (Ctrl+`)", () => {
  it("opens a closed dock, focuses an open one, and closes it from inside the shell", () => {
    expect(dockKeyAction({ open: false, focusInShell: false })).toBe("open");
    expect(dockKeyAction({ open: true, focusInShell: false })).toBe("focus");
    expect(dockKeyAction({ open: true, focusInShell: true })).toBe("close");
  });
});

describe("keys the shell doesn't take", () => {
  const key = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

  it("Ctrl+` toggles the dock on every OS, by the key's position, not what it types", () => {
    expect(isDockToggle(key({ code: "Backquote", key: "`", ctrlKey: true }))).toBe(true);
    expect(isDockToggle(key({ code: "Backquote", key: "Dead", ctrlKey: true }))).toBe(true);
    expect(isDockToggle(key({ code: "Backquote", key: "`", metaKey: true }))).toBe(false);
    expect(isDockToggle(key({ code: "Backquote", key: "~", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isDockToggle(key({ code: "Backquote", key: "`" }))).toBe(false);
  });

  it("the toggle and the drawer chords (Ctrl/⌘+Shift+S, Ctrl/⌘+Shift+Enter) do nothing in the shell", () => {
    expect(isShellReservedKey(key({ code: "Backquote", key: "`", ctrlKey: true }))).toBe(true);
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(isShellReservedKey(key({ key: "S", shiftKey: true, ...mod }))).toBe(true);
      expect(isShellReservedKey(key({ key: "Enter", shiftKey: true, ...mod }))).toBe(true);
    }
  });

  it("everything else reaches the shell: Ctrl+K, Ctrl+W, Ctrl+R, Ctrl+B, Esc, Tab, Enter", () => {
    for (const k of ["k", "w", "r", "b"]) expect(isShellReservedKey(key({ key: k, ctrlKey: true }))).toBe(false);
    for (const k of ["Escape", "Tab", "Enter"]) expect(isShellReservedKey(key({ key: k }))).toBe(false);
    expect(isShellReservedKey(key({ key: "s", ctrlKey: true }))).toBe(false);
  });
});

describe("useTerminalDock", () => {
  beforeEach(() => {
    localStorage.clear();
    useTerminalDock.setState({ open: false, focusTick: 0, prefill: null, binding: null, phase: null });
    document.body.innerHTML = "";
  });

  it("starts closed", () => {
    expect(useTerminalDock.getState().open).toBe(false);
  });

  it("asks for focus only when told to, and gives focus back where it was when it closes", () => {
    const button = document.body.appendChild(document.createElement("button"));
    button.focus();
    useTerminalDock.getState().openDock({ focus: false });
    expect(useTerminalDock.getState()).toMatchObject({ open: true, focusTick: 0 });
    useTerminalDock.getState().openDock({ focus: true });
    expect(useTerminalDock.getState().focusTick).toBe(1);
    // The shell takes focus; closing the dock hands it back.
    const shell = document.body.appendChild(document.createElement("textarea"));
    shell.focus();
    useTerminalDock.getState().closeDock();
    expect(useTerminalDock.getState().open).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it("keeps its height on this machine", () => {
    useTerminalDock.getState().setHeight(360);
    expect(useTerminalDock.getState().height).toBe(360);
    expect(localStorage.getItem(DOCK_HEIGHT_KEY)).toBe("360");
  });

  it("holds one command from an extension at a time: a newer one replaces it", () => {
    const { offerPrefill } = useTerminalDock.getState();
    offerPrefill({ cluster: "kind-dev", command: "stern api", label: "Tail" });
    offerPrefill({ cluster: "kind-dev", command: "k9s", label: "Open k9s" });
    expect(useTerminalDock.getState().prefill).toEqual({ cluster: "kind-dev", command: "k9s", label: "Open k9s" });
    useTerminalDock.getState().clearPrefill();
    expect(useTerminalDock.getState().prefill).toBeNull();
  });
});
