import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { DEFS } from "../../lib/resources";

// Overview v2: a workload's Summary tab says how old its current revision is
// and how many rollouts the week had, and leads to the Rollout tab.

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({ kind: "Deployment", metadata: { name: "web", namespace: "shop", uid: "d-1" } })),
  },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../ActionsBar", () => ({ ActionsBar: () => null }));
vi.mock("../RightSizingBanner", () => ({ RightSizingBanner: () => null }));
vi.mock("../WorkloadHealthChip", () => ({ WorkloadHealthChip: () => null }));
vi.mock("../WarningSparkline", () => ({ WarningSparkline: () => null }));
vi.mock("../RolloutProgress", () => ({ RolloutProgress: () => <div>rollout progress</div> }));
vi.mock("../RolloutLine", () => ({
  RolloutLine: (p: { cluster: string; obj: { metadata: { name: string } }; onShowRollout?: () => void }) => (
    <button type="button" onClick={p.onShowRollout}>
      rollouts of {p.cluster}/{p.obj.metadata.name}
    </button>
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

describe("GenericDrawer rollout line", () => {
  it("shows a Deployment's rollout line on its Summary tab, leading to the Rollout tab", async () => {
    renderDrawer("deployments");
    fireEvent.click(await screen.findByRole("button", { name: "rollouts of c1/web" }));
    expect(screen.getByText("rollout progress")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rollout" })).toHaveAttribute("aria-selected", "true");
  });

  it("does the same for StatefulSets and DaemonSets, which keep ControllerRevisions", async () => {
    for (const slug of ["statefulsets", "daemonsets"] as const) {
      const r = renderDrawer(slug);
      fireEvent.click(await screen.findByRole("button", { name: "rollouts of c1/web" }));
      expect(screen.getByText("rollout progress")).toBeInTheDocument();
      r.unmount();
    }
  });

  it("does not for kinds with no rollouts", async () => {
    renderDrawer("configmaps");
    await screen.findAllByText(/web/);
    expect(screen.queryByText(/rollouts of/)).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Rollout" })).not.toBeInTheDocument();
  });
});
