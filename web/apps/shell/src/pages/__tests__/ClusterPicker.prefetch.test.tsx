import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import ClusterPicker from "../ClusterPicker";
import { api } from "../../lib/api";

vi.mock("../settings/SettingsDrawer", () => {
  throw new Error("chunk failed");
});
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, clusters: vi.fn(() => Promise.resolve([])), fleetSummary: vi.fn() } };
});
vi.mock("../../lib/clusterChannel", () => ({ announceDisconnect: vi.fn(), onRemoteDisconnect: vi.fn(() => () => {}) }));
vi.mock("../../lib/useResourceStream");

describe("Settings button prefetch", () => {
  it("swallows a failed prefetch instead of raising an unhandled rejection", async () => {
    const seen: unknown[] = [];
    const h = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", h);
    void api;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/clusters"]}>
          <ClusterPicker />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await userEvent.hover(await screen.findByRole("button", { name: "Settings" }));
    await new Promise((r) => setTimeout(r, 50));
    process.off("unhandledRejection", h);
    expect(seen).toEqual([]);
  });
});
