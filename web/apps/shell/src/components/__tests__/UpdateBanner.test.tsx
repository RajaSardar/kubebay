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
const available: UpdateStatus = { ...base, state: "available", version: "0.8.1", notes: "Fixes and a faster ⌘K." };

afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
});

describe("the update button (KB-04)", () => {
  it("shows nothing in a browser tab", () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows nothing until an update is found", async () => {
    desktop({ ...base, state: "up-to-date", checkedAt: 1 });
    const { container } = renderBanner();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a button in the corner and installs nothing by itself", async () => {
    const invoke = desktop(available);
    renderBanner();
    expect(await screen.findByRole("button", { name: "Update available: 0.8.1" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("install_update", expect.anything());
  });

  it("opens a popup with the notes, and Update now installs", async () => {
    const invoke = desktop(available);
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Update available: 0.8.1" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Fixes and a faster ⌘K.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("install_update", {});
  });

  it("says why it didn't restart", async () => {
    desktop(available, async () => {
      throw "Kubebay didn't restart: 1 port-forward would be cut off. Restart when it's finished.";
    });
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Update available: 0.8.1" }));
    fireEvent.click(screen.getByRole("button", { name: "Update now" }));
    expect(await screen.findByText(/1 port-forward would be cut off/)).toBeInTheDocument();
  });

  it("closes the popup with Not now and keeps the button", async () => {
    desktop(available);
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Update available: 0.8.1" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update available: 0.8.1" })).toBeInTheDocument();
  });

  it("tells a Homebrew install to upgrade with brew", async () => {
    desktop({ ...base, state: "homebrew", version: "0.8.1" });
    renderBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Update available: 0.8.1" }));
    expect(screen.getByText("brew upgrade --cask kubebay")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Update now" })).not.toBeInTheDocument();
  });
});
