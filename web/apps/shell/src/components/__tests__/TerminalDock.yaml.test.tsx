import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// Backlog 51 phase 1: the dock's tab strip, with YAML editors beside the shell.
// The real editor (Monaco) is stubbed; it reports dirty to the edit guard the
// way YamlTab does.
vi.mock("../DockShell", () => ({ default: () => <div>shell-stub</div> }));
vi.mock("../heavy", async () => {
  const { setEditDirty } = await import("../../lib/editGuard");
  return {
    YamlTab: ({ cluster, gvr, ns, name }: { cluster: string; gvr: string; ns: string; name: string }) => {
      const [text, setText] = useState("");
      const key = `${cluster}/${gvr}/${ns}/${name}`;
      useEffect(() => {
        setEditDirty(key, text !== "");
        return () => setEditDirty(key, false);
      }, [key, text]);
      return <input aria-label={`editor ${name}`} value={text} onChange={(e) => setText(e.target.value)} />;
    },
  };
});
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, get: vi.fn(async () => ({ extraKubeconfigs: [], localShell: { available: true, enabled: true, shell: "zsh", kubectl: { found: true } } })) },
  };
});

const { TerminalDock } = await import("../TerminalDock");
const { useTerminalDock } = await import("../../lib/terminalDock");
const { resetEditGuard } = await import("../../lib/editGuard");

const api = { cluster: "c1", gvr: "apps/v1/deployments", ns: "web", name: "api" };
const web = { ...api, name: "web" };

function renderDock() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TerminalDock selectedCluster="c1" clusters={[]} />
    </QueryClientProvider>,
  );
}
const openTab = (o = api) => act(() => useTerminalDock.getState().openEditTab(o));

describe("TerminalDock YAML tabs", () => {
  beforeEach(() => {
    resetEditGuard();
    useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell", binding: null, phase: null, wantFocus: false });
  });

  it("shows no tab strip until a YAML tab is open", async () => {
    renderDock();
    act(() => useTerminalDock.getState().openDock({ focus: false }));
    await screen.findByText("shell-stub");
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("opening a YAML tab shows a Shell | YAML api strip with the editor", async () => {
    renderDock();
    openTab();
    expect(await screen.findByRole("tab", { name: "Shell" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "YAML api", selected: true })).toBeTruthy();
    expect(screen.getByLabelText("editor api")).toBeTruthy();
  });

  it("switching tabs keeps the editor's text", async () => {
    renderDock();
    openTab();
    fireEvent.change(await screen.findByLabelText("editor api"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("tab", { name: "Shell" }));
    expect(await screen.findByText("shell-stub")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: /^YAML api/ }));
    expect((screen.getByLabelText("editor api") as HTMLInputElement).value).toBe("edited");
  });

  it("hiding the dock keeps the editor's text", async () => {
    renderDock();
    openTab();
    fireEvent.change(await screen.findByLabelText("editor api"), { target: { value: "edited" } });
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
    act(() => useTerminalDock.getState().openDock({ focus: false }));
    expect((await screen.findByLabelText("editor api") as HTMLInputElement).value).toBe("edited");
  });

  it("closing a clean tab closes it at once", async () => {
    renderDock();
    openTab();
    await screen.findByLabelText("editor api");
    fireEvent.click(screen.getByRole("button", { name: "Close YAML tab" }));
    expect(useTerminalDock.getState().tabs).toEqual([]);
    expect(screen.queryByLabelText("editor api")).toBeNull();
  });

  it("closing a dirty tab asks; Keep editing keeps it, Discard closes it", async () => {
    renderDock();
    openTab();
    openTab(web);
    fireEvent.change(await screen.findByLabelText("editor web"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Close YAML tab" }));
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(useTerminalDock.getState().tabs).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Close YAML tab" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useTerminalDock.getState().tabs.map((t) => t.name)).toEqual(["api"]);
  });

  it("another tab's edit does not make closing a clean tab ask", async () => {
    renderDock();
    openTab();
    openTab(web);
    fireEvent.change(await screen.findByLabelText("editor web"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("tab", { name: "YAML api" }));
    fireEvent.click(screen.getByRole("button", { name: "Close YAML tab" }));
    expect(screen.queryByText("Discard changes?")).toBeNull();
    expect(useTerminalDock.getState().tabs.map((t) => t.name)).toEqual(["web"]);
  });
});

describe("TerminalDock phase 2: maximise, keys, label markers", () => {
  beforeEach(() => {
    resetEditGuard();
    useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell", binding: null, phase: null, wantFocus: false, maximized: false });
  });

  it("Maximise grows the dock to its largest height and Restore puts it back", async () => {
    renderDock();
    openTab();
    const dock = await screen.findByRole("region", { name: "Terminal" });
    const before = dock.style.height;
    fireEvent.click(screen.getByRole("button", { name: "Maximise" }));
    expect(dock.style.height).toBe(`${Math.max(120, window.innerHeight - 240)}px`);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(dock.style.height).toBe(before);
  });

  it("a dirty YAML tab shows an unsaved marker in its label", async () => {
    renderDock();
    openTab();
    expect(screen.queryByText(/unsaved/)).toBeNull();
    fireEvent.change(await screen.findByLabelText("editor api"), { target: { value: "x" } });
    expect(screen.getByRole("tab", { name: /YAML api.*unsaved/ })).toBeTruthy();
  });

  it("a production-looking cluster shows a production pill on the YAML tab", async () => {
    renderDock();
    openTab({ ...api, cluster: "eks-prod-eu" });
    const tab = await screen.findByRole("tab", { name: /YAML api/ });
    expect(tab.textContent).toMatch(/production/);
  });

  it("Ctrl+W closes a clean YAML tab and asks first on a dirty one", async () => {
    renderDock();
    openTab();
    openTab(web);
    fireEvent.change(await screen.findByLabelText("editor web"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByLabelText("editor web"), { key: "w", ctrlKey: true });
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(useTerminalDock.getState().tabs.map((t) => t.name)).toEqual(["api"]);
    act(() => useTerminalDock.getState().focusTab("c1/apps/v1/deployments/web/api"));
    fireEvent.keyDown(screen.getByLabelText("editor api"), { key: "w", ctrlKey: true });
    expect(useTerminalDock.getState().tabs).toEqual([]);
  });

  it("Ctrl+PageDown / Ctrl+PageUp move between the dock's tabs", async () => {
    renderDock();
    openTab();
    openTab(web);
    fireEvent.keyDown(await screen.findByLabelText("editor web"), { key: "PageDown", ctrlKey: true });
    expect(useTerminalDock.getState().activeTab).toBe("shell");
    fireEvent.keyDown(await screen.findByText("shell-stub"), { key: "PageUp", ctrlKey: true });
    expect(useTerminalDock.getState().activeTab).toBe("c1/apps/v1/deployments/web/web");
  });

  it("Ctrl+W on the Shell tab is left to the terminal", async () => {
    renderDock();
    openTab();
    act(() => useTerminalDock.getState().focusTab("shell"));
    const ev = new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true });
    (await screen.findByText("shell-stub")).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(useTerminalDock.getState().tabs).toHaveLength(1);
  });

  it("shows a banner on the YAML tab when its cluster is disconnected", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <TerminalDock selectedCluster="c1" clusters={[{ id: "c1", context: "c1", server: "", status: "unreachable" }]} />
      </QueryClientProvider>,
    );
    openTab();
    expect(await screen.findByText(/cluster is not connected/i)).toBeTruthy();
  });
});
