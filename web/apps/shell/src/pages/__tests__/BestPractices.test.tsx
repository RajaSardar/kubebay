import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import BestPractices from "../BestPractices";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

const privDep = {
  metadata: { namespace: "shop", name: "priv" },
  spec: { replicas: 1, template: { metadata: { labels: { app: "priv" } }, spec: { containers: [{ name: "c", image: "nginx:1.25", securityContext: { privileged: true } }] } } },
};

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) =>
    gvr === "apps/v1/deployments"
      ? { rows: [privDep], synced: true, connected: true }
      : gvr === "v1/nodes"
        ? { rows: [], synced: false, connected: true, forbidden: "forbidden: nodes" }
        : { rows: [], synced: true, connected: true },
  ),
}));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  discoveryApi: { apis: vi.fn(async () => [{ group: "apps" }]) },
}));

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BestPractices />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BestPractices page", () => {
  it("shows a summary strip with pass, fail and unknown counted separately", async () => {
    renderPage();
    const strip = await screen.findByRole("group", { name: "Summary" });
    expect(within(strip).getByText(/Fail/)).toBeInTheDocument();
    expect(within(strip).getByText(/Unknown/)).toBeInTheDocument();
    expect(within(strip).getByText(/Critical/)).toBeInTheDocument();
  });

  it("filters to unknown checks only, which are never shown as Pass", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "unknown");
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeGreaterThan(0);
    for (const li of items) {
      expect(within(li).queryByText("Pass")).toBeNull();
      expect(within(li).getByText("Unknown")).toBeInTheDocument();
    }
  });

  it("filters by severity", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "Critical");
    expect(screen.getByText("No privileged containers")).toBeInTheDocument();
    expect(screen.queryByText("Liveness probes")).toBeNull();
  });

  it("has a Learn disclosure with a lesson and the docs link as text", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    await userEvent.selectOptions(screen.getByLabelText("Severity"), "Critical");
    const li = screen.getByText("No privileged containers").closest("li")!;
    await userEvent.click(within(li).getByRole("button", { name: /Learn/ }));
    expect(within(li).getByText(/skips most of the isolation/)).toBeInTheDocument();
    expect(within(li).getByText(/kubernetes\.io\/docs/)).toBeInTheDocument();
  });
});
