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

  it("names what the workload checks covered", async () => {
    renderPage();
    const cov = await screen.findByLabelText("Coverage");
    expect(cov).toHaveTextContent(/Deployments 1/);
    expect(cov).toHaveTextContent(/DaemonSets 0/);
  });

  it("shows a CIS reference tag on a mapped check only", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    const li = screen.getByText("No privileged containers").closest("li")!;
    expect(within(li).getByText("CIS 5.2.2")).toHaveAttribute("title", expect.stringMatching(/reference/i));
    expect(within(screen.getByText("Images use a pinned tag").closest("li")!).queryByText(/CIS/)).toBeNull();
  });

  it("ignores a check with a reason, leaves it out of the score, and undoes it", async () => {
    localStorage.clear();
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    let li = screen.getByText("No privileged containers").closest("li")!;
    await userEvent.click(within(li).getByRole("button", { name: "Ignore this check" }));
    await userEvent.click(within(li).getByRole("button", { name: "Save exception" }));
    expect(within(li).getByText(/reason is required/i)).toBeInTheDocument();
    await userEvent.type(within(li).getByLabelText("Reason"), "node agent");
    await userEvent.click(within(li).getByRole("button", { name: "Save exception" }));
    li = screen.getByText("No privileged containers").closest("li")!;
    expect(within(li).getByText("Ignored")).toBeInTheDocument();
    expect(within(li).getByText(/node agent/)).toBeInTheDocument();
    expect(within(li).queryByText("Pass")).toBeNull();
    expect(within(screen.getByRole("group", { name: "Summary" })).getByText("Ignored 1")).toBeInTheDocument();
    expect(localStorage.getItem("kb.bestPractices.exceptions.c1")).toContain("node agent");
    await userEvent.click(within(li).getByRole("button", { name: "Undo ignore" }));
    expect(within(screen.getByText("No privileged containers").closest("li")!).getByText("Fail")).toBeInTheDocument();
    expect(localStorage.getItem("kb.bestPractices.exceptions.c1")).toBeNull();
  });

  it("ignores a check for one namespace", async () => {
    localStorage.clear();
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    const li = screen.getByText("No privileged containers").closest("li")!;
    await userEvent.click(within(li).getByRole("button", { name: "Ignore for namespace shop" }));
    await userEvent.type(within(li).getByLabelText("Reason"), "ok");
    await userEvent.click(within(li).getByRole("button", { name: "Save exception" }));
    expect(within(screen.getByText("No privileged containers").closest("li")!).getByText("Ignored")).toBeInTheDocument();
    expect(localStorage.getItem("kb.bestPractices.exceptions.c1")).toContain('"namespace":"shop"');
  });

  it("exports the result as JSON or Markdown", async () => {
    renderPage();
    await screen.findByRole("group", { name: "Summary" });
    await userEvent.click(screen.getByRole("button", { name: "Export report" }));
    expect(screen.getByRole("button", { name: "Save JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Markdown" })).toBeInTheDocument();
  });
});
