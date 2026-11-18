import { beforeEach, describe, expect, it } from "vitest";
import { dockEditItem, editTabKey, useTerminalDock } from "../terminalDock";

// Backlog 51 phase 2: maximise, tab cycling and the "Edit in dock" entry point.
const a = { cluster: "c1", gvr: "apps/v1/deployments", ns: "web", name: "api" };
const b = { ...a, name: "web" };

describe("dock maximise and tab cycling", () => {
  beforeEach(() => useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell", maximized: false }));

  it("toggleMaximized flips the flag", () => {
    useTerminalDock.getState().toggleMaximized();
    expect(useTerminalDock.getState().maximized).toBe(true);
    useTerminalDock.getState().toggleMaximized();
    expect(useTerminalDock.getState().maximized).toBe(false);
  });

  it("cycleTab moves through shell and YAML tabs and wraps", () => {
    const s = useTerminalDock.getState();
    s.openEditTab(a);
    s.openEditTab(b);
    expect(useTerminalDock.getState().activeTab).toBe(editTabKey(b));
    useTerminalDock.getState().cycleTab(1);
    expect(useTerminalDock.getState().activeTab).toBe("shell");
    useTerminalDock.getState().cycleTab(1);
    expect(useTerminalDock.getState().activeTab).toBe(editTabKey(a));
    useTerminalDock.getState().cycleTab(-1);
    expect(useTerminalDock.getState().activeTab).toBe("shell");
    useTerminalDock.getState().cycleTab(-1);
    expect(useTerminalDock.getState().activeTab).toBe(editTabKey(b));
  });
});

describe("dockEditItem", () => {
  beforeEach(() => useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell" }));

  it("is a menu item that opens the object as a dock tab", () => {
    const item = dockEditItem(a);
    expect(item.label).toBe("Edit in dock");
    item.onClick();
    expect(useTerminalDock.getState().tabs.map((t) => t.name)).toEqual(["api"]);
    expect(useTerminalDock.getState().open).toBe(true);
  });
});
