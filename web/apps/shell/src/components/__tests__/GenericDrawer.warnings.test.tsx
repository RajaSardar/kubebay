import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { DEFS } from "../../lib/resources";

// Overview v2: a workload's Summary tab carries its last hour of warnings.

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({ kind: "Deployment", metadata: { name: "web", namespace: "shop", uid: "d-1" } })),
  },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../ActionsBar", () => ({ ActionsBar: () => null }));
vi.mock("../RightSizingBanner", () => ({ RightSizingBanner: () => null }));
vi.mock("../WorkloadHealthChip", () => ({
  WorkloadHealthChip: (p: { cluster: string; obj: { metadata: { name: string } } | null }) => <div>7 days of {p.cluster}/{p.obj?.metadata.name}</div>,
}));
vi.mock("../WarningSparkline", () => ({
  WarningSparkline: (p: { cluster: string; obj: { metadata: { name: string } } | null }) => <div>warnings of {p.cluster}/{p.obj?.metadata.name}</div>,
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

describe("GenericDrawer warnings", () => {
  it("shows a workload's last hour of warnings on its Summary tab", async () => {
    renderDrawer("deployments");
    expect(await screen.findByText("warnings of c1/web")).toBeInTheDocument();
    expect(screen.getByText("7 days of c1/web")).toBeInTheDocument();
  });

  it("does not for kinds without pods", async () => {
    renderDrawer("configmaps");
    await screen.findAllByText(/web/);
    expect(screen.queryByText(/warnings of/)).not.toBeInTheDocument();
    expect(screen.queryByText(/7 days of/)).not.toBeInTheDocument();
  });
});

describe("GenericDrawer: Compare with…", () => {
  it("opens the compare dialog with this object as the left side; a cluster-scoped kind has no namespace", async () => {
    const { useCompare } = await import("../../lib/compare-store");
    renderDrawer("deployments");
    fireEvent.click(await screen.findByRole("button", { name: "Compare with…" }));
    expect(useCompare.getState()).toMatchObject({
      open: true,
      left: { cluster: "c1", gvr: "apps/v1/deployments", ns: "shop", name: "web", kind: "Deployment" },
      right: null,
    });
    useCompare.getState().close();
    renderDrawer("nodes");
    fireEvent.click((await screen.findAllByRole("button", { name: "Compare with…" })).at(-1)!);
    expect(useCompare.getState().left).toMatchObject({ gvr: "v1/nodes", ns: "" });
  });
});
