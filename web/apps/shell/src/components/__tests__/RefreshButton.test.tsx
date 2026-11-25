import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RefreshButton } from "../RefreshButton";
import { _resetRefreshForTests, useRefreshEpoch } from "../../lib/refreshAll";

describe("RefreshButton", () => {
  afterEach(() => _resetRefreshForTests());

  it("refreshes everything and names its shortcut", () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries").mockResolvedValue();
    const before = useRefreshEpoch.getState().epoch;
    render(
      <QueryClientProvider client={qc}>
        <RefreshButton />
      </QueryClientProvider>,
    );
    const btn = screen.getByRole("button", { name: "Refresh" });
    expect(btn.getAttribute("title")).toMatch(/^Refresh everything \((⌘R|Ctrl\+R)\)$/);
    fireEvent.click(btn);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useRefreshEpoch.getState().epoch).toBe(before + 1);
  });
});
