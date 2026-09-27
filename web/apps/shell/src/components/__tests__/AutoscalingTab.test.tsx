import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AutoscalingSummary, AutoscalingTab } from "../AutoscalingTab";
import { crdApi } from "../../lib/api";

function scaledObject(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-so", namespace: "default" },
    spec: {
      scaleTargetRef: { name: "app", kind: "Deployment" },
      minReplicaCount: 1,
      maxReplicaCount: 20,
      triggers: [{ type: "cpu", metadata: { value: "50" } }],
    },
    status: { currentReplicas: 3 },
    ...overrides,
  };
}

function hpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-hpa", namespace: "default" },
    spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, minReplicas: 2, maxReplicas: 8 },
    status: { currentReplicas: 4 },
    ...overrides,
  };
}

function vpa(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { name: "app-vpa", namespace: "default" },
    spec: { targetRef: { name: "app", kind: "Deployment" }, updatePolicy: { updateMode: "Off" } },
    ...overrides,
  };
}

describe("AutoscalingSummary", () => {
  it("shows a 'no autoscalers' empty state when nothing targets this workload", () => {
    render(<AutoscalingSummary scaledObjects={[]} hpas={[]} vpas={[]} />);
    expect(screen.getByText(/no autoscaler/i)).toBeTruthy();
  });

  it("shows a Managed by KEDA badge and the plain-English explanation for a ScaledObject", () => {
    render(<AutoscalingSummary scaledObjects={[scaledObject()]} hpas={[]} vpas={[]} />);
    expect(screen.getByText(/managed by keda/i)).toBeTruthy();
    expect(screen.getByText(/1→20/)).toBeTruthy();
  });

  it("flags minReplicaCount: 0 with a visible warning", () => {
    const so = scaledObject({ spec: { scaleTargetRef: { name: "app", kind: "Deployment" }, minReplicaCount: 0, maxReplicaCount: 10, triggers: [] } });
    render(<AutoscalingSummary scaledObjects={[so]} hpas={[]} vpas={[]} />);
    expect(screen.getByText(/scale.to.zero/i)).toBeTruthy();
  });

  it("flags an HPA/ScaledObject conflict targeting the same workload", () => {
    render(<AutoscalingSummary scaledObjects={[scaledObject()]} hpas={[hpa()]} vpas={[]} />);
    expect(screen.getByText(/conflict/i)).toBeTruthy();
  });

  it("lists an HPA's min/max/current even with no ScaledObject present", () => {
    render(<AutoscalingSummary scaledObjects={[]} hpas={[hpa()]} vpas={[]} />);
    expect(screen.queryByText(/managed by keda/i)).toBeNull();
    expect(screen.getByText(/2.*8/)).toBeTruthy();
  });

  it("lists a VPA's update mode", () => {
    render(<AutoscalingSummary scaledObjects={[]} hpas={[]} vpas={[vpa()]} />);
    expect(screen.getByText(/Off/)).toBeTruthy();
  });
});

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, crdApi: { list: vi.fn() } };
});

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: [], synced: true, connected: true }),
}));

vi.mock("../KedaWizard", () => ({
  KedaWizard: ({ targetName }: { targetName: string }) => <div data-testid="keda-wizard">wizard for {targetName}</div>,
}));

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AutoscalingTab cluster="kind-test" ns="team-a" name="checkout" kind="Deployment" />
    </QueryClientProvider>,
  );
}

describe("AutoscalingTab — Add ScaledObject wizard (backlog #2 P3)", () => {
  it("shows no Add-ScaledObject affordance when KEDA isn't installed on this cluster", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([]);
    renderTab();
    await waitFor(() => expect(vi.mocked(crdApi.list)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /add scaledobject/i })).toBeNull();
  });

  it("toggles the wizard open and closed when KEDA is installed", async () => {
    vi.mocked(crdApi.list).mockResolvedValue([
      {
        name: "scaledobjects.keda.sh",
        gvr: "keda.sh/v1alpha1/scaledobjects",
        group: "keda.sh",
        version: "v1alpha1",
        resource: "scaledobjects",
        kind: "ScaledObject",
        namespaced: true,
        columns: [],
      },
    ]);
    renderTab();

    const addButton = await screen.findByRole("button", { name: /add scaledobject/i });
    expect(screen.queryByTestId("keda-wizard")).toBeNull();

    fireEvent.click(addButton);
    expect((await screen.findByTestId("keda-wizard")).textContent).toBe("wizard for checkout");

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(screen.queryByTestId("keda-wizard")).toBeNull();
  });
});
