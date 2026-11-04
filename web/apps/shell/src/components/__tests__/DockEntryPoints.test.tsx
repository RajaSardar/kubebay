import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

// ADR 0005: the ways into the terminal dock. The status bar's toggle, the
// sidebar's Terminal, Ctrl+` from anywhere (inside the shell too) and a
// /terminal link all open the dock; none of them navigates away.

const capability = vi.hoisted(() => ({ available: true }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      get: vi.fn(async () => ({ extraKubeconfigs: [], localShell: capability.available ? { available: true } : { available: false } })),
    },
  };
});

const { DockToggle, SidebarTerminal, useDockInset, useDockShortcut } = await import("../DockEntryPoints");
const { useTerminalDock } = await import("../../lib/terminalDock");
const { default: TerminalPage } = await import("../../pages/TerminalPage");

function wrap(children: ReactNode, entries: unknown[] = ["/"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={entries as never}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

function Where() {
  const loc = useLocation();
  return <output aria-label="location">{loc.pathname}</output>;
}

beforeEach(() => {
  capability.available = true;
  useTerminalDock.setState({ open: false, wantFocus: false, binding: null, phase: null, prefill: null });
  document.body.innerHTML = "";
});

describe("the status bar's Terminal toggle", () => {
  it("opens the dock with its shell focused, and closes it", async () => {
    render(wrap(<DockToggle />));
    const toggle = await screen.findByRole("button", { name: /Terminal/ });
    expect(toggle).toHaveTextContent("Ctrl `");
    fireEvent.click(toggle);
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: true });
    fireEvent.click(toggle);
    expect(useTerminalDock.getState().open).toBe(false);
  });

  it("names the live shell's context, and marks one that reads like production", async () => {
    useTerminalDock.setState({ binding: { cluster: "eks-prod", context: "arn:aws:eks:x:cluster/prod" }, phase: { at: "live" } });
    render(wrap(<DockToggle />));
    expect(await screen.findByText("arn:aws:eks:x:cluster/prod")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  it("isn't there on an engine without a local shell", async () => {
    capability.available = false;
    render(wrap(<DockToggle />));
    await act(async () => {});
    expect(screen.queryByRole("button", { name: /Terminal/ })).toBeNull();
  });
});

describe("the sidebar's Terminal", () => {
  it("opens the dock with its shell focused, without leaving the page", () => {
    render(
      wrap(
        <>
          <SidebarTerminal />
          <Where />
        </>,
        ["/r/pods"],
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: true });
    expect(screen.getByRole("status", { name: "location" })).toHaveTextContent("/r/pods");
  });
});

describe("Ctrl+`", () => {
  const press = (target: Element = document.body) =>
    act(() => {
      target.dispatchEvent(new KeyboardEvent("keydown", { code: "Backquote", key: "`", ctrlKey: true, bubbles: true }));
    });

  it("opens the dock and focuses the shell, focuses it again from elsewhere, and closes it from inside the shell", () => {
    renderHook(() => useDockShortcut());
    press();
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: true });
    useTerminalDock.getState().focusDone();
    const button = document.body.appendChild(document.createElement("button"));
    button.focus();
    press(button);
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: true });
    const dock = document.body.appendChild(document.createElement("section"));
    dock.className = "kb-dock";
    const shell = dock.appendChild(document.createElement("div"));
    shell.className = "kb-dock-term";
    const input = shell.appendChild(document.createElement("textarea"));
    input.focus();
    press(input);
    expect(useTerminalDock.getState().open).toBe(false);
  });

  it("is the dock's, not the page's or the shell's", () => {
    renderHook(() => useDockShortcut());
    const other = vi.fn();
    window.addEventListener("keydown", other);
    const e = new KeyboardEvent("keydown", { code: "Backquote", key: "`", ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(e);
    });
    window.removeEventListener("keydown", other);
    expect(e.defaultPrevented).toBe(true);
    expect(other).not.toHaveBeenCalled();
  });
});

describe("useDockInset", () => {
  it("is how far above the window's bottom the open dock begins, and 0 while it's closed", () => {
    const el = document.createElement("section");
    el.getBoundingClientRect = () => ({ top: window.innerHeight - 330 }) as DOMRect;
    const ref = { current: el };
    const { result, rerender } = renderHook(({ open }) => useDockInset(ref, open, 300), { initialProps: { open: true } });
    expect(result.current).toBe(330);
    rerender({ open: false });
    expect(result.current).toBe(0);
  });
});

describe("/terminal", () => {
  it("opens the dock and goes back to the page you came from", async () => {
    render(
      wrap(
        <Routes>
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="*" element={<Where />} />
        </Routes>,
        ["/r/pods", "/terminal"],
      ),
    );
    expect(await screen.findByRole("status", { name: "location" })).toHaveTextContent("/r/pods");
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: true });
  });

  it("on a link opened cold, goes to the Overview", async () => {
    render(
      wrap(
        <Routes>
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="*" element={<Where />} />
        </Routes>,
        ["/terminal"],
      ),
    );
    expect(await screen.findByRole("status", { name: "location" })).toHaveTextContent("/workloads-overview");
  });

  it("hands an extension's command to the dock, without focusing the shell", async () => {
    const prefill = { cluster: "kind-test", command: "stern api", label: "Tail" };
    render(
      wrap(
        <Routes>
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="*" element={<Where />} />
        </Routes>,
        ["/r/pods", { pathname: "/terminal", state: { prefill } }],
      ),
    );
    await screen.findByRole("status", { name: "location" });
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: false, prefill });
  });

  it("ignores route state that isn't a command action", async () => {
    render(
      wrap(
        <Routes>
          <Route path="/terminal" element={<TerminalPage />} />
          <Route path="*" element={<Where />} />
        </Routes>,
        ["/r/pods", { pathname: "/terminal", state: { prefill: { cluster: "kind-test", command: 42 } } }],
      ),
    );
    await screen.findByRole("status", { name: "location" });
    expect(useTerminalDock.getState()).toMatchObject({ open: true, wantFocus: true, prefill: null });
  });
});
