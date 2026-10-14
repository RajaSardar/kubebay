import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { DEFS } from "../../lib/resources";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({
      kind: "ResourceClaim",
      metadata: { name: "e2e-gpu", namespace: "kubebay-dra", uid: "rc-1" },
      spec: { devices: { requests: [{ name: "gpu", exactly: { deviceClassName: "gpu.example.com" } }] } },
      status: {
        allocation: { devices: { results: [{ request: "gpu", driver: "gpu.example.com", pool: "worker", device: "gpu-3" }] } },
        reservedFor: [{ resource: "pods", name: "e2e-gpu-pod", uid: "p-1" }],
      },
    })),
  },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../ActionsBar", () => ({ ActionsBar: () => null }));

describe("GenericDrawer: a ResourceClaim's Summary", () => {
  it("shows the claim's allocation, not just its metadata", async () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <GenericDrawer cluster="c1" def={DEFS.resourceclaims!} ns="kubebay-dra" name="e2e-gpu" onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("worker/gpu-3")).toBeInTheDocument();
    expect(screen.getByText("allocated,reserved")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "e2e-gpu-pod" })).toBeInTheDocument();
  });
});
