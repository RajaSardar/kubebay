import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UpdatesCard } from "../UpdatesCard";
import type { UpdateStatus } from "../../lib/updates";

type W = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };

function desktop(status: UpdateStatus) {
  const invoke = vi.fn(async (cmd: string, args?: unknown) => {
    if (cmd === "set_update_checks") return { ...status, autoCheck: (args as { enabled: boolean }).enabled };
    return status;
  });
  (window as unknown as W).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <UpdatesCard />
    </QueryClientProvider>,
  );
}

const base = { currentVersion: "0.8.0", autoCheck: true };

afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
});

describe("UpdatesCard (KB-04)", () => {
  it("isn't shown in a browser tab", async () => {
    const { container } = renderCard();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("says when this build doesn't update itself", async () => {
    desktop({ ...base, state: "unavailable" });
    renderCard();
    expect(await screen.findByText(/This build doesn't update itself/)).toBeInTheDocument();
    // Text, not a link: a link would navigate the app's own window away.
    expect(screen.getByText("github.com/RajaSardar/kubebay/releases")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("explains the one request it makes and lets you turn it off", async () => {
    const invoke = desktop({ ...base, state: "up-to-date", checkedAt: Date.UTC(2026, 9, 17, 9, 0) });
    renderCard();
    const box = await screen.findByRole("checkbox", { name: "Check for updates automatically" });
    expect(box).toBeChecked();
    expect(screen.getByText(/only request Kubebay makes on its own/)).toBeInTheDocument();
    expect(screen.getByText(/github\.com\/RajaSardar\/kubebay\/releases\/latest\/download\/latest\.json/)).toBeInTheDocument();
    expect(screen.getByText(/You're on 0\.8\.0/)).toBeInTheDocument();
    expect(screen.getByText(/Up to date/)).toBeInTheDocument();
    fireEvent.click(box);
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("set_update_checks", { enabled: false });
    expect(screen.getByRole("checkbox", { name: "Check for updates automatically" })).not.toBeChecked();
  });

  it("checks now", async () => {
    const invoke = desktop({ ...base, state: "idle" });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
    await act(async () => {});
    expect(invoke).toHaveBeenCalledWith("check_for_updates", {});
  });

  it("explains an install that can't update itself, and a failed check", async () => {
    desktop({ ...base, state: "manual" });
    const { unmount } = renderCard();
    expect(await screen.findByText(/can't update itself/)).toBeInTheDocument();
    unmount();
    desktop({ ...base, state: "failed", error: "Network request failed", checkedAt: 1 });
    renderCard();
    expect(await screen.findByText(/The last check failed: Network request failed/)).toBeInTheDocument();
  });
});
