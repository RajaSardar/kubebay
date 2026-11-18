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
    fireEvent.click(screen.getByRole("tab", { name: "YAML api" }));
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
