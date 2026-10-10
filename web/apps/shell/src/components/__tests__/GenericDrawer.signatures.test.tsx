import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { DEFS } from "../../lib/resources";
import { imageSigApi } from "../../lib/api";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({
      kind: "Deployment",
      metadata: { name: "web", namespace: "shop", uid: "d-1" },
      spec: { selector: { matchLabels: { app: "web" } } },
    })),
  },
  imageSigApi: { check: vi.fn(async () => []) },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../ActionsBar", () => ({ ActionsBar: () => null }));
vi.mock("../RightSizingBanner", () => ({ RightSizingBanner: () => null }));

function renderDrawer(slug: keyof typeof DEFS) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GenericDrawer cluster="c1" def={DEFS[slug]!} ns="shop" name="web" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GenericDrawer Signatures tab (backlog #45)", () => {
  it("checks only this workload's pods, by its own selector", async () => {
    renderDrawer("deployments");
    fireEvent.click(screen.getByRole("tab", { name: "Signatures" }));
    fireEvent.click(await screen.findByRole("button", { name: "Check signatures" }));
    await vi.waitFor(() => expect(imageSigApi.check).toHaveBeenCalledWith("c1", false, { ns: "shop", selector: "app=web" }));
  });

  it("has no Signatures tab for kinds without pods", () => {
    renderDrawer("configmaps");
    expect(screen.queryByRole("tab", { name: "Signatures" })).not.toBeInTheDocument();
  });
});
