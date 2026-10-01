import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Rbac from "../Rbac";
import { useResourceStream } from "../../lib/useResourceStream";

vi.mock("../../lib/useCluster", () => ({
  useCluster: () => ({ cluster: "c1", setCluster: vi.fn(), list: [{ id: "c1" }], isLoading: false }),
}));

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: vi.fn((_c: string, gvr: string) => ({
    rows: gvr === "v1/secrets" ? [{ metadata: { name: "old-creds", namespace: "shop" } }] : [],
    synced: true,
  })),
  shouldShowSkeleton: () => false,
}));

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  rbacApi: {
    all: vi.fn(async () => ({ roles: [], clusterRoles: [], roleBindings: [], clusterRoleBindings: [], findings: [] })),
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Rbac />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Rbac", () => {
  it("streams Secrets in metadata mode only, so Secret values never reach the shell", () => {
    renderPage();
    const secretCalls = vi.mocked(useResourceStream).mock.calls.filter(([, g]) => g === "v1/secrets");
    expect(secretCalls.length).toBeGreaterThan(0);
    for (const [, , opts] of secretCalls) expect((opts as { mode?: string } | undefined)?.mode).toBe("metadata");
  });

  it("lists Secrets nothing references", async () => {
    renderPage();
    expect(await screen.findByText("old-creds")).toBeInTheDocument();
  });

  it("offers an on-demand signature check of the images actually running", async () => {
    renderPage();
    expect(await screen.findByText("Running image signatures")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check signatures" })).toBeInTheDocument();
  });

  it("offers the audit-log security feed", async () => {
    renderPage();
    expect(await screen.findByText("Audit-log security events")).toBeInTheDocument();
  });
});
