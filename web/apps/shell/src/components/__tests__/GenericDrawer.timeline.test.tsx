import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { DEFS } from "../../lib/resources";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({ kind: "Deployment", metadata: { name: "web", namespace: "shop", uid: "d-1" } })),
  },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../ActionsBar", () => ({ ActionsBar: () => null }));
vi.mock("../RightSizingBanner", () => ({ RightSizingBanner: () => null }));
vi.mock("../TimelineTab", () => ({
  TimelineTab: (p: { obj: { metadata: { name: string } } | null }) => <div>timeline of {p.obj?.metadata.name}</div>,
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

describe("GenericDrawer Timeline tab", () => {
  it("offers a Timeline tab for workloads, showing the loaded object", async () => {
    renderDrawer("deployments");
    fireEvent.click(screen.getByRole("tab", { name: "Timeline" }));
    expect(await screen.findByText("timeline of web")).toBeInTheDocument();
  });

  it("has no Timeline tab for kinds without pods", () => {
    renderDrawer("configmaps");
    expect(screen.queryByRole("tab", { name: "Timeline" })).not.toBeInTheDocument();
  });
});
