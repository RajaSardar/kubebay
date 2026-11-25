import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AiStatus } from "../lib/aiInvestigate";

const h = vi.hoisted(() => {
  const st = { current: null as unknown as AiStatus };
  const api = {
    status: vi.fn(async () => st.current),
    setEnabled: vi.fn(async (enabled: boolean) => {
      st.current = { ...st.current, enabled, state: enabled ? "ready" : "off-by-user" };
      return st.current;
    }),
  };
  return Object.assign(st, { api });
});
vi.mock("../lib/aiInvestigate", async (orig) => ({ ...(await orig<typeof import("../lib/aiInvestigate")>()), aiApi: h.api }));

import { AiSettingsCard } from "./AiSettingsCard";

const base: AiStatus = { state: "ready", enabled: true, noticeVersion: 1, limits: { seconds: 300, bytes: 1 }, claudePath: "/usr/local/bin/claude" };

function renderCard() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AiSettingsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.current = base;
  h.api.setEnabled.mockClear();
});

describe("AiSettingsCard", () => {
  it("turns the feature off for this user", async () => {
    renderCard();
    const box = (await screen.findByRole("checkbox", { name: "Allow Investigate with AI" })) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    await waitFor(() => expect(h.api.setEnabled).toHaveBeenCalledWith(false));
  });

  it("says plainly where it runs and what it sends", async () => {
    renderCard();
    expect((await screen.findAllByText(/Claude Code/)).length).toBeGreaterThan(0);
    expect(screen.getByText(/no API key/i)).toBeTruthy();
  });

  it("is locked, with the reason, on a shared engine", async () => {
    h.current = { ...base, state: "locked", enabled: false, reason: "AI investigations are off here: shared engine" };
    renderCard();
    expect(await screen.findByText(/shared engine/)).toBeTruthy();
    expect((screen.getByRole("checkbox", { name: "Allow Investigate with AI" }) as HTMLInputElement).disabled).toBe(true);
  });
});
