import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../lib/api";
import { KedaInventory } from "./KedaInventory";

const navigateMock = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, api: { ...actual.api, applyYaml: vi.fn().mockResolvedValue({ applied: true, dryRun: false }) } };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

beforeEach(() => {
  navigateMock.mockClear();
});

function so(name: string, ns: string, opts: { minReplicas?: number; targetName?: string } = {}) {
  return {
    metadata: { name, namespace: ns },
    spec: {
      scaleTargetRef: { name: opts.targetName ?? "app", kind: "Deployment" },
      minReplicaCount: opts.minReplicas ?? 1,
      maxReplicaCount: 10,
      triggers: [{ type: "cpu" }],
    },
  };
}

function hpa(targetName: string, ns: string) {
  return { metadata: { name: "hpa-1", namespace: ns }, spec: { scaleTargetRef: { name: targetName, kind: "Deployment" } } };
}

function renderInventory(props: Partial<Parameters<typeof KedaInventory>[0]> = {}) {
  return render(
    <MemoryRouter>
      <KedaInventory scaledObjects={[]} hpas={[]} orphanedTriggerAuths={[]} {...props} />
    </MemoryRouter>,
  );
}

describe("KedaInventory", () => {
  it("shows an empty state when there are no ScaledObjects", () => {
    renderInventory();
    expect(screen.getByText(/no scaledobjects/i)).toBeTruthy();
  });

  it("lists every ScaledObject across namespaces", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod"), so("so-b", "staging")] });
    expect(screen.getByText("so-a")).toBeTruthy();
    expect(screen.getByText("so-b")).toBeTruthy();
  });

  it("flags a ScaledObject whose target is also owned by an HPA", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod", { targetName: "app" })], hpas: [hpa("app", "prod")] });
    expect(screen.getByText(/dual ownership/i)).toBeTruthy();
  });

  it("flags scale-to-zero ScaledObjects", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod", { minReplicas: 0 })] });
    expect(screen.getByText(/minReplicaCount: 0/)).toBeTruthy();
  });

  it("filters to conflicts only when that filter is selected", () => {
    renderInventory({
      scaledObjects: [so("so-conflict", "prod", { targetName: "app" }), so("so-clean", "prod", { targetName: "other" })],
      hpas: [hpa("app", "prod")],
    });
    fireEvent.click(screen.getByRole("button", { name: /conflicts/i }));
    expect(screen.getByText("so-conflict")).toBeTruthy();
    expect(screen.queryByText("so-clean")).toBeNull();
  });

  it("filters to scale-to-zero only when that filter is selected", () => {
    renderInventory({
      scaledObjects: [so("so-zero", "prod", { minReplicas: 0 }), so("so-normal", "prod", { minReplicas: 2 })],
    });
    fireEvent.click(screen.getByRole("button", { name: /scale-to-zero/i }));
    expect(screen.getByText("so-zero")).toBeTruthy();
    expect(screen.queryByText("so-normal")).toBeNull();
  });

  it("navigates to the ScaledObject's own detail page on click, using the ext-- CRD slug", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod")], scaledObjectGvr: "keda.sh/v1alpha1/scaledobjects" });
    fireEvent.click(screen.getByText("so-a"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/ext--keda.sh--v1alpha1--scaledobjects/prod/so-a");
  });

  it("renders the ScaledObject name as plain text (no link) when no GVR is known", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod")] });
    fireEvent.click(screen.getByText("so-a"));
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("lists orphaned TriggerAuthentications with a warning", () => {
    renderInventory({ orphanedTriggerAuths: [{ name: "unused-auth", ns: "prod", scoped: true }] });
    expect(screen.getByText("unused-auth")).toBeTruthy();
    expect(screen.getAllByText(/orphan/i).length).toBeGreaterThan(0);
  });

  it("does not show the orphaned-auth section when there are none", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod")], orphanedTriggerAuths: [] });
    expect(screen.queryAllByText(/orphan/i).length).toBe(0);
  });

  it("shows Paused for a paused ScaledObject and Active for others", () => {
    const paused = { ...so("so-p", "prod"), metadata: { name: "so-p", namespace: "prod", annotations: { "autoscaling.keda.sh/paused": "true" } } };
    renderInventory({ scaledObjects: [paused, so("so-a", "prod")] });
    expect(screen.getAllByText("Paused")).toHaveLength(1);
    expect(screen.getAllByText("Active")).toHaveLength(1);
  });

  const GVR = "keda.sh/v1alpha1/scaledobjects";

  it("pauses at the replica count typed in the modal, defaulting to current replicas", async () => {
    const withStatus = { ...so("so-a", "prod"), status: { currentReplicas: 4 } };
    renderInventory({ scaledObjects: [withStatus], cluster: "c1", scaledObjectGvr: GVR });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    const input = screen.getByLabelText("Replicas to hold") as HTMLInputElement;
    expect(input.value).toBe("4");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Pause autoscaling" }));
    await vi.waitFor(() => expect(api.applyYaml).toHaveBeenCalled());
    const body = vi.mocked(api.applyYaml).mock.calls.at(-1)![0];
    expect(body.yaml).toContain('paused-replicas: "0"');
    expect(body.mode).toBe("merge");
  });

  it("unpauses a paused ScaledObject", async () => {
    const paused = { ...so("so-p", "prod"), metadata: { name: "so-p", namespace: "prod", annotations: { "autoscaling.keda.sh/paused-replicas": "2" } } };
    renderInventory({ scaledObjects: [paused], cluster: "c1", scaledObjectGvr: GVR });
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unpause" }));
    await vi.waitFor(() => expect(vi.mocked(api.applyYaml).mock.calls.at(-1)![0].action).toBe("keda-unpause"));
  });

  it("shows no pause controls without a cluster", () => {
    renderInventory({ scaledObjects: [so("so-a", "prod")] });
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });
});
