import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { DEFS } from "../../lib/resources";

// Backlog 75: a workload's Summary ends with a Pods section.

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({ kind: "StatefulSet", metadata: { name: "web", namespace: "shop", uid: "d-1" } })),
  },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../ActionsBar", () => ({ ActionsBar: () => null }));
vi.mock("../RightSizingBanner", () => ({ RightSizingBanner: () => null }));
vi.mock("../WorkloadHealthChip", () => ({ WorkloadHealthChip: () => null }));
vi.mock("../WarningSparkline", () => ({ WarningSparkline: () => null }));
vi.mock("../RolloutLine", () => ({ RolloutLine: () => null }));
vi.mock("../WorkloadPods", () => ({
  WorkloadPods: (p: { cluster: string; kind?: string; obj: { metadata: { name: string } } }) => (
    <div>pods of {p.cluster}/{p.obj.metadata.name} as {p.kind}</div>
  ),
}));

vi.mock("../WorkloadLogs", () => ({
  WorkloadLogs: (p: { cluster: string; kind?: string; obj: { metadata: { name: string } } }) => (
    <div>logs of {p.cluster}/{p.obj.metadata.name} as {p.kind}</div>
  ),
}));

function renderDrawer(slug: keyof typeof DEFS) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GenericDrawer cluster="c1" def={DEFS[slug]!} ns="shop" name="web" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GenericDrawer pods", () => {
  it("lists a StatefulSet's pods on its Summary", async () => {
    renderDrawer("statefulsets");
    expect(await screen.findByText("pods of c1/web as StatefulSet")).toBeInTheDocument();
  });

  it("does the same for Deployments, DaemonSets and Jobs", async () => {
    for (const slug of ["deployments", "daemonsets", "jobs"] as const) {
      const { unmount } = renderDrawer(slug);
      expect(await screen.findByText(`pods of c1/web as ${DEFS[slug]!.kind}`)).toBeInTheDocument();
      unmount();
    }
  });

  it("not for kinds without pods", async () => {
    renderDrawer("configmaps");
    await screen.findAllByText(/web/);
    expect(screen.queryByText(/pods of/)).not.toBeInTheDocument();
  });

  // Backlog 59: all the pods' logs in one view.
  it("has a Logs tab on workloads that own pods, showing every pod's logs together", async () => {
    renderDrawer("deployments");
    fireEvent.click(await screen.findByRole("tab", { name: "Logs" }));
    expect(await screen.findByText("logs of c1/web as Deployment")).toBeInTheDocument();
  });

  it("has no Logs tab on kinds without pods", async () => {
    renderDrawer("configmaps");
    await screen.findAllByText(/web/);
    expect(screen.queryByRole("tab", { name: "Logs" })).not.toBeInTheDocument();
  });
});
