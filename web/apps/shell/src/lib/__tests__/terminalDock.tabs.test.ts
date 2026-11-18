import { beforeEach, describe, expect, it } from "vitest";
import { editTabKey, useTerminalDock } from "../terminalDock";

// Backlog 51 phase 1: YAML editor tabs share the dock's store with the shell.
const obj = { cluster: "c1", gvr: "apps/v1/deployments", ns: "web", name: "api" };

describe("dock edit tabs", () => {
  beforeEach(() => useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell", wantFocus: false }));

  it("keys a tab by cluster/gvr/ns/name", () => {
    expect(editTabKey(obj)).toBe("c1/apps/v1/deployments/web/api");
  });

  it("opening a tab opens the dock and focuses the tab", () => {
    useTerminalDock.getState().openEditTab(obj);
    const s = useTerminalDock.getState();
    expect(s.open).toBe(true);
    expect(s.tabs.map((t) => t.key)).toEqual([editTabKey(obj)]);
    expect(s.activeTab).toBe(editTabKey(obj));
  });

  it("opening the same object again focuses the one tab instead of adding another", () => {
    const st = useTerminalDock.getState();
    st.openEditTab(obj);
    st.openEditTab({ ...obj, name: "other" });
    st.openEditTab(obj);
    const s = useTerminalDock.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTab).toBe(editTabKey(obj));
  });

  it("closing the active tab falls back to the shell, and the last close leaves no tabs", () => {
    const st = useTerminalDock.getState();
    st.openEditTab(obj);
    st.closeEditTab(editTabKey(obj));
    const s = useTerminalDock.getState();
    expect(s.tabs).toEqual([]);
    expect(s.activeTab).toBe("shell");
  });

  it("hiding the dock keeps its tabs", () => {
    useTerminalDock.getState().openEditTab(obj);
    useTerminalDock.getState().closeDock();
    expect(useTerminalDock.getState().tabs).toHaveLength(1);
  });
});
