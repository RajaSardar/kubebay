import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Palette } from "../Palette";

vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: () => ({ rows: [], synced: true, connected: true }) }));
vi.mock("../../lib/api", async (orig) => {
  const actual = await orig<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, clusters: vi.fn(async () => []), pfList: vi.fn(async () => []) } };
});

function Where() {
  return <div data-testid="at">{useLocation().pathname}</div>;
}

// Backlog 76: the Issues queue is one keystroke away.
describe("Palette: Issues", () => {
  it("offers the Issues page", () => {
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
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "issues" } });
    fireEvent.click(screen.getByText(/^Issues/));
    expect(screen.getByTestId("at").textContent).toBe("/issues");
  });
});
