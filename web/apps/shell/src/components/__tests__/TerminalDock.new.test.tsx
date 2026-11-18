import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Backlog 51 phases 3 to 5: New resource tabs in the dock, and the text budget message.
vi.mock("../DockShell", () => ({ default: () => <div>shell-stub</div> }));
vi.mock("../heavy", () => ({
  YamlTab: ({ name }: { name: string }) => <div>yaml-stub {name}</div>,
  NewResourceTab: ({ initialKind }: { initialKind?: string }) => <div>new-stub {initialKind}</div>,
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, get: vi.fn(async () => ({ extraKubeconfigs: [], localShell: { available: true, enabled: true, shell: "zsh", kubectl: { found: true } } })) },
  };
});

const { TerminalDock } = await import("../TerminalDock");
const { useTerminalDock, EDIT_TEXT_BUDGET } = await import("../../lib/terminalDock");
const { resetEditGuard, setEditDirty } = await import("../../lib/editGuard");

function renderDock() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TerminalDock selectedCluster="c1" clusters={[]} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetEditGuard();
  useTerminalDock.setState({ open: false, tabs: [], activeTab: "shell", binding: null, phase: null, wantFocus: false, sizes: {}, capMessage: null });
});

describe("New resource tab in the dock", () => {
  it("is labelled New resource and hosts the creator", async () => {
    renderDock();
    act(() => useTerminalDock.getState().openNewTab({ kind: "Service" }));
    expect(await screen.findByRole("tab", { name: /new resource/i })).toBeTruthy();
    expect(screen.getByText("new-stub Service")).toBeTruthy();
  });

  it("asks before closing a dirty New resource tab", async () => {
    renderDock();
    act(() => useTerminalDock.getState().openNewTab({}));
    const key = useTerminalDock.getState().tabs[0]!.key;
    act(() => setEditDirty(key, true));
    fireEvent.click(screen.getByRole("button", { name: /close yaml tab|close tab/i }));
    expect(screen.getByRole("dialog", { name: /discard changes/i })).toBeTruthy();
  });
});

describe("the text budget message", () => {
  it("tells you to close a tab when a new one is refused, and can be dismissed", async () => {
    renderDock();
    act(() => {
      const s = useTerminalDock.getState();
      s.openEditTab({ cluster: "c1", gvr: "v1/configmaps", ns: "d", name: "big" });
      s.reportSize("c1/v1/configmaps/d/big", EDIT_TEXT_BUDGET);
      s.openEditTab({ cluster: "c1", gvr: "v1/configmaps", ns: "d", name: "more" });
    });
    expect(await screen.findByText(/close a tab/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByText(/close a tab/i)).toBeNull();
  });
});
