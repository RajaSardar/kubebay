import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// Backlog 51 phase 1: the drawer's YAML tab keeps its editor by default, offers
// the dock as an option, and never shows a second live editor for an object
// that is open in the dock.
vi.mock("../heavy", async () => {
  const { setEditDirty } = await import("../../lib/editGuard");
  return {
    YamlTab: ({ cluster, gvr, ns, name }: { cluster: string; gvr: string; ns: string; name: string }) => (
      <button onClick={() => setEditDirty(`${cluster}/${gvr}/${ns}/${name}`, true)}>drawer-editor-stub</button>
    ),
  };
});

const { DrawerYaml } = await import("../DrawerYaml");
const { useTerminalDock } = await import("../../lib/terminalDock");
const { resetEditGuard } = await import("../../lib/editGuard");

const obj = { cluster: "c1", gvr: "apps/v1/deployments", ns: "web", name: "api" };

describe("DrawerYaml", () => {
  beforeEach(() => {
    resetEditGuard();
    useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell" });
  });

  it("shows the drawer editor by default, with an opt-in Open in bottom dock", () => {
    render(<DrawerYaml {...obj} />);
    expect(screen.getByText("drawer-editor-stub")).toBeTruthy();
    expect(useTerminalDock.getState().tabs).toEqual([]);
  });

  it("Open in bottom dock opens a dock tab and the drawer shows Editing in dock, not a second editor", () => {
    render(<DrawerYaml {...obj} gitopsOwner={null} helmRelease="rel" />);
    fireEvent.click(screen.getByRole("button", { name: "Open in bottom dock" }));
    const s = useTerminalDock.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]).toMatchObject({ name: "api", helmRelease: "rel" });
    expect(screen.getByText("Editing in dock.")).toBeTruthy();
    expect(screen.queryByText("drawer-editor-stub")).toBeNull();
  });

  it("Go to tab shows the dock on that tab", () => {
    act(() => useTerminalDock.getState().openEditTab(obj));
    act(() => useTerminalDock.getState().closeDock());
    act(() => useTerminalDock.getState().focusTab("shell"));
    render(<DrawerYaml {...obj} />);
    fireEvent.click(screen.getByRole("button", { name: "Go to tab" }));
    const s = useTerminalDock.getState();
    expect(s.open).toBe(true);
    expect(s.activeTab).toBe("c1/apps/v1/deployments/web/api");
  });

  it("closing the dock tab brings the drawer editor back", () => {
    act(() => useTerminalDock.getState().openEditTab(obj));
    render(<DrawerYaml {...obj} />);
    act(() => useTerminalDock.getState().closeEditTab("c1/apps/v1/deployments/web/api"));
    expect(screen.getByText("drawer-editor-stub")).toBeTruthy();
  });

  it("with unapplied drawer edits, asks before moving to the dock", () => {
    render(<DrawerYaml {...obj} />);
    fireEvent.click(screen.getByText("drawer-editor-stub")); // marks it dirty
    fireEvent.click(screen.getByRole("button", { name: "Open in bottom dock" }));
    expect(screen.getByText("Discard changes?")).toBeTruthy();
    expect(useTerminalDock.getState().tabs).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useTerminalDock.getState().tabs).toHaveLength(1);
  });
});
