import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NotificationsCard } from "../NotificationsCard";
import { loadNotifySettings } from "../../lib/issueNotifications";

vi.mock("../../lib/api", () => ({
  api: { clusters: async () => [{ id: "dev" }, { id: "prod" }] },
}));

type W = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> } };

function desktop(permission: string) {
  const invoke = vi.fn(async (cmd: string) => (cmd === "request_notification_permission" ? permission : undefined));
  (window as unknown as W).__TAURI_INTERNALS__ = { invoke };
  return invoke;
}
function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  delete (window as unknown as W).__TAURI_INTERNALS__;
});

describe("NotificationsCard (backlog 85)", () => {
  it("isn't shown in a browser tab", async () => {
    const { container } = renderCard();
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("is off by default, with Critical only and nothing muted, and says what a notification holds", async () => {
    desktop("granted");
    renderCard();
    expect(await screen.findByRole("checkbox", { name: "Notify me about new issues" })).not.toBeChecked();
    expect(screen.getByLabelText("Lowest severity to notify")).toHaveValue("critical");
    expect(screen.getByText(/never log lines or Secret data/)).toBeTruthy();
  });

  it("asks the OS for permission when switched on and saves the choice", async () => {
    const invoke = desktop("granted");
    renderCard();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Notify me about new issues" }));
    expect(invoke).toHaveBeenCalledWith("request_notification_permission");
    expect(loadNotifySettings().enabled).toBe(true);
  });

  it("stays off and points to System Settings when the OS refuses", async () => {
    desktop("denied");
    renderCard();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Notify me about new issues" }));
    expect(loadNotifySettings().enabled).toBe(false);
    expect(await screen.findByText(/System Settings/)).toBeTruthy();
  });

  it("saves the threshold and per-cluster mutes", async () => {
    desktop("granted");
    renderCard();
    await userEvent.selectOptions(await screen.findByLabelText("Lowest severity to notify"), "high");
    expect(loadNotifySettings().minSeverity).toBe("high");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mute prod" }));
    expect(loadNotifySettings().mutedClusters).toEqual(["prod"]);
    await userEvent.click(screen.getByRole("checkbox", { name: "Mute prod" }));
    expect(loadNotifySettings().mutedClusters).toEqual([]);
  });
});
