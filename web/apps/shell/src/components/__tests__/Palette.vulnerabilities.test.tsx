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

// Root backlog #16: the Vulnerabilities page is one keystroke away, like the other pages.
describe("Palette: Vulnerabilities", () => {
  it("offers the Vulnerabilities page", () => {
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
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "vuln" } });
    fireEvent.click(screen.getByText(/^Vulnerabilities/));
    expect(screen.getByTestId("at").textContent).toBe("/vulnerabilities");
  });
});
