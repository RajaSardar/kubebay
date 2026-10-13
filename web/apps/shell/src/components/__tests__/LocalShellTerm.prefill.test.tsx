import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalShellTerm } from "../LocalShellTerm";
import type { ChannelTermOptions, TermHandle } from "../../lib/useChannelTerm";

// KB-13: a command action opens the terminal with its command typed at the
// prompt, once, and never with Enter.

const sessions: ChannelTermOptions[] = [];
vi.mock("../../lib/useChannelTerm", () => ({
  useChannelTerm: (opts: ChannelTermOptions) => {
    if (!sessions.includes(opts)) sessions.push(opts);
    return { hostRef: { current: null } };
  },
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    settingsApi: { ...actual.settingsApi, get: vi.fn(async () => ({ extraKubeconfigs: [], localShell: { available: true, enabled: true, shell: "zsh" } })) },
  };
});

const clusters = [{ id: "kind-test", context: "kind-dev", server: "https://127.0.0.1:6443", status: "reachable" as const }];
const prefill = { cluster: "kind-test", command: "stern -n 'shop' 'api-1'", label: "Tail with stern" };

function handle(): TermHandle & { paste: ReturnType<typeof vi.fn> } {
  return { write: vi.fn(), paste: vi.fn(), channelId: "lsh-1", reopen: vi.fn() };
}

function renderTerm(p = prefill) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocalShellTerm selectedCluster="kind-test" clusters={clusters} prefill={p} />
    </QueryClientProvider>,
  );
}

/** The live session: the last one useChannelTerm was given. */
const current = () => sessions[sessions.length - 1]!;

describe("LocalShellTerm with a command to type", () => {
  beforeEach(() => {
    sessions.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it("says what it will type and that it won't run it", async () => {
    renderTerm();
    expect(await screen.findByText(/Tail with stern/)).toBeInTheDocument();
    expect(screen.getByText("stern -n 'shop' 'api-1'")).toBeInTheDocument();
    expect(screen.getByText(/won.t press Enter/)).toBeInTheDocument();
  });

  it("types it once the prompt settles, without Enter, and not again after a restart", async () => {
    renderTerm();
    await screen.findByText(/Tail with stern/);
    vi.useFakeTimers();
    const h = handle();
    act(() => {
      current().onSetup?.(h);
      current().onData?.(new TextEncoder().encode("$ "), h);
      vi.advanceTimersByTime(1000);
    });
    expect(h.paste).toHaveBeenCalledTimes(1);
    expect(h.paste).toHaveBeenCalledWith("stern -n 'shop' 'api-1'");
    expect(h.paste.mock.calls[0]![0]).not.toMatch(/[\r\n]/);
    expect(screen.getByText(/press Enter to run it/)).toBeInTheDocument();

    // The shell exits and the user restarts it: a fresh prompt, nothing typed.
    act(() => current().onClosed?.("exit status 0", h));
    vi.useRealTimers();
    fireEvent.click(await screen.findByRole("button", { name: "Restart" }));
    vi.useFakeTimers();
    const h2 = handle();
    act(() => {
      current().onSetup?.(h2);
      current().onData?.(new TextEncoder().encode("$ "), h2);
      vi.advanceTimersByTime(1000);
    });
    expect(h2.paste).not.toHaveBeenCalled();
  });

  it("types nothing into a shell on another cluster", async () => {
    renderTerm({ ...prefill, cluster: "other" });
    await screen.findByText(/Bound to context/);
    expect(screen.queryByText(/Tail with stern/)).toBeNull();
    vi.useFakeTimers();
    const h = handle();
    act(() => {
      current().onSetup?.(h);
      current().onData?.(new TextEncoder().encode("$ "), h);
      vi.advanceTimersByTime(1000);
    });
    expect(h.paste).not.toHaveBeenCalled();
  });
});
