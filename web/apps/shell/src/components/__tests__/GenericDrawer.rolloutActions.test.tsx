import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import GenericDrawer from "../GenericDrawer";
import { extSlug, lookupDef } from "../../lib/resources";

// Custom Resources > Rollouts opens the same drawer, so it gets the same Rollout actions.

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  api: {
    getObject: vi.fn(async () => ({
      apiVersion: "argoproj.io/v1alpha1",
      kind: "Rollout",
      metadata: { name: "web", namespace: "shop", uid: "r-1" },
      spec: { replicas: 2, strategy: { canary: { steps: [{ setWeight: 20 }, { pause: {} }] } } },
      status: { phase: "Progressing", currentStepIndex: 0 },
    })),
  },
}));
vi.mock("../heavy", () => ({ ExecTerm: () => null, YamlTab: () => null }));
vi.mock("../RightSizingBanner", () => ({ RightSizingBanner: () => null }));
vi.mock("../WorkloadHealthChip", () => ({ WorkloadHealthChip: () => null }));
vi.mock("../WarningSparkline", () => ({ WarningSparkline: () => null }));

function renderFor(gvr: string) {
  const slug = `ext--${extSlug(gvr)}`;
  const def = lookupDef(slug, new URLSearchParams("scoped=1"));
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <GenericDrawer cluster="c1" def={def!} ns="shop" name="web" onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GenericDrawer: Rollout actions from Custom Resources", () => {
  it.each(["argoproj.io/v1alpha1/rollouts", "argoproj.io/v1beta1/rollouts"])("%s offers Promote, Abort and Restart", async (gvr) => {
    renderFor(gvr);
    for (const n of ["Promote", "Promote fully", "Abort", "Restart"]) {
      expect(await screen.findByRole("button", { name: n })).toBeInTheDocument();
    }
  });
});
