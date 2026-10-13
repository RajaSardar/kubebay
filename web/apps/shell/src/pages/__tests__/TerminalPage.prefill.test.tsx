import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import TerminalPage from "../TerminalPage";

// KB-13: a command action navigates here with the command in the route state.

const seen: { selectedCluster: string; prefill?: unknown }[] = [];
vi.mock("../../components/LocalShellTerm", () => ({
  LocalShellTerm: (p: { selectedCluster: string; prefill?: unknown }) => {
    seen.push(p);
    return <div data-testid="term">{p.selectedCluster}</div>;
  },
}));
vi.mock("../../App", () => ({
  useActiveCluster: () => ({ active: "kind-test", setActive: vi.fn(), switching: false }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, clusters: vi.fn(async () => []) } };
});

function renderAt(state: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: "/terminal", state }]}>
        <Routes>
          <Route path="/terminal" element={<TerminalPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TerminalPage", () => {
  it("passes a command action's line to the shell", async () => {
    const prefill = { cluster: "kind-test", command: "stern 'api'", label: "Tail" };
    renderAt({ prefill });
    await screen.findByTestId("term");
    expect(seen[0]).toMatchObject({ selectedCluster: "kind-test", prefill });
  });

  it("ignores route state that isn't a command action", async () => {
    seen.length = 0;
    renderAt({ prefill: { cluster: "kind-test", command: 42 } });
    await screen.findByTestId("term");
    expect(seen[0]?.prefill).toBeUndefined();
  });
});
