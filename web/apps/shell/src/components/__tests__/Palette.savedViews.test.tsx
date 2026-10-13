import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Palette } from "../Palette";
import { useSavedViews } from "../../lib/savedViews";
import { api } from "../../lib/api";

vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: () => ({ rows: [], synced: true, connected: true }) }));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, clusters: vi.fn(async () => []), pfList: vi.fn(async () => []) } };
});

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname}</div>;
}

describe("Palette: saved views (KB-16)", () => {
  beforeEach(() => {
    localStorage.clear();
    useSavedViews.setState({ views: [] });
    vi.mocked(api.clusters).mockResolvedValue([]);
  });

  it("finds a saved view by name and opens it", () => {
    const v = useSavedViews.getState().add({ name: "Crashing shop pods", cluster: "kind-dev", kind: "deployments", namespaces: [], filter: "" });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/"]}>
          <Palette open onClose={() => {}} />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "crashing" } });
    fireEvent.click(screen.getByText("View: Crashing shop pods"));
    expect(screen.getByTestId("at").textContent).toBe(`/view/${v.id}`);
  });
});
