import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ChanSpec, Handlers } from "../../lib/ws";
import type { SessionDeps, TermLike } from "../../lib/shellSession";

// ADR 0005: the terminal dock. A bottom panel holding today's bound local
// shell, which outlives every page change, with its context named, asks
// before a context that reads like production, and never types a command
// into a shell that's already running.

const fake = vi.hoisted(() => {
  const state = {
    made: 0,
    open: [] as ChanSpec[],
    close: [] as string[],
    pastes: [] as string[],
    handlers: [] as Handlers[],
    focused: 0,
  };
  return state;
});

vi.mock("../../lib/xtermTerm", () => {
  const deps: SessionDeps = {
    makeTerm(): TermLike {
      fake.made++;
      const element = document.createElement("div");
      element.tabIndex = -1;
      element.className = "xterm";
      return {
        element,
        write: () => {},
        paste: (t) => fake.pastes.push(t),
        focus: () => {
          fake.focused++;
          element.focus();
        },
        fit: () => {},
        propose: () => ({ cols: 100, rows: 20 }),
        onData: () => {},
        dispose: () => {},
      };
    },
    observeSize: () => () => {},
    ws: {
      attach: (h: Handlers) => {
        fake.handlers.push(h);
        h.onStatus?.(true);
        return () => {
          fake.handlers = fake.handlers.filter((x) => x !== h);
        };
      },
      openChannel: (c: ChanSpec) => fake.open.push(c),
      closeChannel: (id: string) => fake.close.push(id),
      resizeChannel: () => {},
      chanSend: () => {},
    },
  };
  return { xtermDeps: deps };
});

const capability = vi.hoisted(() => ({ available: true }));

// The engine's socket, up or down, as the dock's Restart sees it.
const socket = vi.hoisted(() => ({ up: true, subs: new Set<() => void>() }));
vi.mock("../../lib/useWsStatus", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useWsStatus: () => {
      const connected = useSyncExternalStore(
        (cb) => {
          socket.subs.add(cb);
          return () => socket.subs.delete(cb);
        },
        () => socket.up,
      );
      return { connected, retryAttempt: 0, nextRetryMs: 0, hasEverConnected: true };
    },
  };
});
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      get: vi.fn(async () => ({
        extraKubeconfigs: [],
        localShell: capability.available
          ? { available: true, enabled: true, shell: "zsh", kubectl: { found: true } }
          : { available: false, reason: "not built into this binary" },
      })),
    },
  };
});

const { TerminalDock } = await import("../TerminalDock");
const { useTerminalDock } = await import("../../lib/terminalDock");
const { currentShell, setCurrentShell } = await import("../../lib/shellSession");

const clusters = [
  { id: "kind-test", context: "kind-dev", server: "https://127.0.0.1:6443", status: "reachable" as const },
  { id: "kind-other", context: "kind-other", server: "https://127.0.0.1:6444", status: "reachable" as const },
  { id: "eks-prod", context: "arn:aws:eks:eu-west-1:1:cluster/prod", server: "https://eks", status: "reachable" as const },
];

const emit = {
  data: (s: string) => fake.handlers.forEach((h) => h.onChanData?.(fake.open.at(-1)!.id, new TextEncoder().encode(s))),
  closed: (msg: string) => fake.handlers.forEach((h) => h.onChanClosed?.(fake.open.at(-1)!.id, msg)),
  status: (up: boolean) => {
    socket.up = up;
    socket.subs.forEach((f) => f());
    fake.handlers.forEach((h) => h.onStatus?.(up));
  },
};

function renderDock(selectedCluster = "kind-test") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TerminalDock selectedCluster={selectedCluster} clusters={clusters} />
    </QueryClientProvider>,
  );
}

const dock = () => screen.findByRole("region", { name: "Terminal" });
const openDock = (focus = false) => act(() => useTerminalDock.getState().openDock({ focus }));
const closeDock = () => act(() => useTerminalDock.getState().closeDock());

describe("TerminalDock", () => {
  beforeEach(() => {
    Object.assign(fake, { made: 0, open: [], close: [], pastes: [], handlers: [], focused: 0 });
    capability.available = true;
    socket.up = true;
    useTerminalDock.setState({ open: false, binding: null, phase: null, prefill: null, wantFocus: false, autoOpen: true });
  });
  afterEach(() => {
    act(() => currentShell()?.end());
    setCurrentShell(null);
    vi.useRealTimers();
  });

  it("isn't there until it's opened, and builds no terminal until then", () => {
    renderDock();
    expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
    expect(fake.made).toBe(0);
    expect(fake.open).toEqual([]);
  });

  it("opens a shell bound to the cluster you're looking at, and names its context", async () => {
    renderDock();
    openDock();
    const region = await dock();
    expect(await within(region).findByText("kind-dev")).toBeInTheDocument();
    expect(within(region).getByText(/^Terminal/)).toBeInTheDocument();
    expect(fake.open).toEqual([expect.objectContaining({ kind: "local-shell", cluster: "kind-test" })]);
    expect(within(region).getByRole("button", { name: "Hide" })).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "End shell" })).toBeInTheDocument();
  });

  it("keeps the shell while hidden and shown twenty times: the same channel, never closed", async () => {
    renderDock();
    openDock();
    await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    for (let i = 0; i < 20; i++) {
      closeDock();
      expect(screen.queryByRole("region", { name: "Terminal" })).toBeNull();
      openDock();
      await dock();
    }
    expect(fake.open).toHaveLength(1);
    expect(fake.close).toEqual([]);
    expect(fake.made).toBe(1);
  });

  it("focuses the shell only when asked to", async () => {
    renderDock();
    openDock(false);
    await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    expect(fake.focused).toBe(0);
    openDock(true);
    await vi.waitFor(() => expect(fake.focused).toBe(1));
  });

  it("asks before the first shell on a context that reads like production, and marks it as a name check", async () => {
    renderDock("eks-prod");
    openDock();
    const region = await dock();
    const open = await within(region).findByRole("button", { name: /Open shell on arn:aws:eks/ });
    expect(fake.open).toEqual([]);
    fireEvent.click(open);
    fireEvent.click(within(region).getByRole("button", { name: /Yes/ }));
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    const pill = within(region).getByText("production");
    expect(pill.textContent).toMatch(/production/);
    expect(region).toHaveTextContent(/name check only/);
  });

  it("restarts after the shell ends, but not while the engine is unreachable, and asks first on production", async () => {
    renderDock();
    openDock();
    const region = await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    act(() => emit.closed("exit code 1"));
    const restart = await within(region).findByRole("button", { name: "Restart" });
    act(() => emit.status(false));
    expect(within(region).getByRole("button", { name: "Restart" })).toBeDisabled();
    act(() => emit.status(true));
    fireEvent.click(within(region).getByRole("button", { name: "Restart" }));
    expect(fake.open).toHaveLength(2);
    void restart;
  });

  it("asks before restarting a shell on production", async () => {
    renderDock("eks-prod");
    openDock();
    const region = await dock();
    fireEvent.click(await within(region).findByRole("button", { name: /Open shell on/ }));
    fireEvent.click(within(region).getByRole("button", { name: /Yes/ }));
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    act(() => emit.closed("exit code 1"));
    fireEvent.click(await within(region).findByRole("button", { name: "Restart" }));
    expect(fake.open).toHaveLength(1);
    fireEvent.click(within(region).getByRole("button", { name: /Confirm/ }));
    expect(fake.open).toHaveLength(2);
  });

  it("ends the shell on End shell and offers a new one without opening it", async () => {
    renderDock();
    openDock();
    const region = await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    fireEvent.click(within(region).getByRole("button", { name: "End shell" }));
    expect(fake.close).toEqual([fake.open[0]!.id]);
    expect(await within(region).findByRole("button", { name: "Open a shell on kind-dev" })).toBeInTheDocument();
    expect(fake.open).toHaveLength(1);
  });

  it("with no shell, types an extension's command into a new one on its cluster, once, without Enter or focus", async () => {
    renderDock();
    act(() => useTerminalDock.getState().offerPrefill({ cluster: "kind-other", command: "stern -n shop api", label: "Tail with stern" }));
    openDock();
    const region = await dock();
    await vi.waitFor(() => expect(fake.open).toEqual([expect.objectContaining({ cluster: "kind-other" })]));
    vi.useFakeTimers();
    act(() => {
      emit.data("$ ");
      vi.advanceTimersByTime(1000);
    });
    vi.useRealTimers();
    expect(fake.pastes).toEqual(["stern -n shop api"]);
    expect(fake.focused).toBe(0);
    expect(within(region).getByText(/press Enter to run it/)).toBeInTheDocument();
  });

  it("never types an extension's command into a running shell: it offers Copy and Type into this shell", async () => {
    renderDock();
    openDock();
    const region = await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    act(() => emit.data("$ "));
    act(() => useTerminalDock.getState().offerPrefill({ cluster: "kind-test", command: "k9s", label: "Open k9s" }));
    expect(await within(region).findByText("k9s")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(fake.pastes).toEqual([]);
    fireEvent.click(within(region).getByRole("button", { name: "Type into this shell" }));
    expect(fake.pastes).toEqual(["k9s"]);
    expect(within(region).queryByRole("button", { name: "Type into this shell" })).toBeNull();
  });

  it("for another cluster's command, offers to open a shell there, asking first, and a newer command replaces it", async () => {
    renderDock();
    openDock();
    const region = await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    act(() => emit.data("$ "));
    act(() => useTerminalDock.getState().offerPrefill({ cluster: "kind-other", command: "stern api", label: "Tail" }));
    act(() => useTerminalDock.getState().offerPrefill({ cluster: "kind-other", command: "stern web", label: "Tail web" }));
    expect(await within(region).findByText("stern web")).toBeInTheDocument();
    expect(within(region).queryByText("stern api")).toBeNull();
    expect(within(region).queryByRole("button", { name: "Type into this shell" })).toBeNull();
    fireEvent.click(within(region).getByRole("button", { name: "Open a shell on kind-other" }));
    expect(fake.open).toHaveLength(1);
    fireEvent.click(within(region).getByRole("button", { name: /Confirm/ }));
    await vi.waitFor(() => expect(fake.open.at(-1)).toEqual(expect.objectContaining({ cluster: "kind-other" })));
    expect(fake.close).toEqual([fake.open[0]!.id]);
  });

  it("offers a shell on the cluster you've moved to, and keeps this one until you say so", async () => {
    const view = renderDock();
    openDock();
    const region = await dock();
    await vi.waitFor(() => expect(fake.open).toHaveLength(1));
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <TerminalDock selectedCluster="kind-other" clusters={clusters} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/This shell stays on/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep this shell" }));
    expect(screen.queryByText(/This shell stays on/)).toBeNull();
    expect(fake.open).toHaveLength(1);
    void region;
  });

  it("says when the engine has no local shell, without building a terminal", async () => {
    capability.available = false;
    renderDock();
    openDock();
    const region = await dock();
    expect(await within(region).findByText("This engine build has no local shell.")).toBeInTheDocument();
    expect(fake.made).toBe(0);
  });
});
