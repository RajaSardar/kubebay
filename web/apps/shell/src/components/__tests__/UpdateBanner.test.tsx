import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UpdateBanner } from "../UpdateBanner";
import type { UpdateStatus } from "../../lib/updates";

type W = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };

function desktop(status: UpdateStatus, install?: () => Promise<unknown>) {
  const invoke = vi.fn(async (cmd: string) => {
    if (cmd === "install_update") return install ? install() : null;
    return status;
  });
  (window as unknown as W).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

function renderBanner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UpdateBanner />
    </QueryClientProvider>,
  );
}

const base = { currentVersion: "0.8.0", autoCheck: true };

afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
});

describe("UpdateBanner (KB-04)", () => {
  it("shows nothing in a browser tab", () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing until an update is ready", async () => {
    desktop({ ...base, state: "up-to-date", checkedAt: 1 });
    const { container } = renderBanner();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("offers to restart into a downloaded update", async () => {
    const invoke = desktop({ ...base, state: "ready", version: "0.8.1", notes: null });
    renderBanner();
    expect(await screen.findByText("Kubebay 0.8.1 is ready to install.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restart to update" }));
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("install_update", {});
  });

  it("says why it didn't restart", async () => {
    desktop({ ...base, state: "ready", version: "0.8.1", notes: null }, async () => {
      throw "Kubebay didn't restart: 1 port-forward would be cut off. Restart when it's finished.";
    });
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Restart to update" }));
    expect(await screen.findByText(/1 port-forward would be cut off/)).toBeInTheDocument();
  });

  it("goes away until the next launch when you choose Later", async () => {
    desktop({ ...base, state: "ready", version: "0.8.1", notes: null });
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByText(/is ready to install/)).not.toBeInTheDocument();
  });

  it("tells a Homebrew install to upgrade with brew", async () => {
    desktop({ ...base, state: "homebrew", version: "0.8.1" });
    renderBanner();
    expect(await screen.findByText(/Kubebay 0\.8\.1 is out/)).toBeInTheDocument();
    expect(screen.getByText("brew upgrade --cask kubebay")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restart to update" })).not.toBeInTheDocument();
  });
});
