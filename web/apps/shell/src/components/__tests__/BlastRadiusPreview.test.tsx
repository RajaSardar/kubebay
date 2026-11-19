import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BlastRadiusPreview } from "../BlastRadiusPreview";

vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: vi.fn() }));
const { useResourceStream } = await import("../../lib/useResourceStream");

type Rows = Record<string, unknown>[];
let byGvr: Record<string, { rows: Rows; synced?: boolean; forbidden?: string }> = {};

const labels = { app: "web" };
const deploy = {
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop" },
  spec: { selector: { matchLabels: labels }, template: { metadata: { labels } } },
};
const pods = [
  { metadata: { name: "web-1", namespace: "shop", labels, ownerReferences: [{ kind: "ReplicaSet", name: "web-rs" }] }, spec: { nodeName: "n1" } },
];
const rs = [{ metadata: { name: "web-rs", namespace: "shop", ownerReferences: [{ kind: "Deployment", name: "web" }] } }];

beforeEach(() => {
  byGvr = {
    "v1/pods": { rows: pods },
    "apps/v1/replicasets": { rows: rs },
    "v1/services": { rows: [{ metadata: { name: "web", namespace: "shop" }, spec: { selector: labels } }] },
    "networking.k8s.io/v1/ingresses": { rows: [] },
    "autoscaling/v2/horizontalpodautoscalers": { rows: [] },
    "policy/v1/poddisruptionbudgets": { rows: [] },
  };
  vi.mocked(useResourceStream).mockReset();
  vi.mocked(useResourceStream).mockImplementation(((_c: unknown, gvr: string) => {
    const s = byGvr[gvr] ?? { rows: [] };
    return { rows: s.rows, synced: s.synced ?? true, connected: true, forbidden: s.forbidden };
  }) as never);
});

describe("BlastRadiusPreview", () => {
  it("starts collapsed with a one-line summary, and never blocks", () => {
    render(<BlastRadiusPreview cluster="kind-shop" kind="Deployment" obj={deploy} action="delete" />);
    expect(screen.getByRole("button", { name: /What this affects/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/1 pod/)).toBeInTheDocument();
  });

  it("opens to list the affected objects with examples", () => {
    render(<BlastRadiusPreview cluster="kind-shop" kind="Deployment" obj={deploy} action="delete" />);
    fireEvent.click(screen.getByRole("button", { name: /What this affects/ }));
    expect(screen.getByText("web-1")).toBeInTheDocument();
    expect(screen.getByText(/Service losing all endpoints/)).toBeInTheDocument();
  });

  it("says unknown for a stream it cannot read", () => {
    byGvr["policy/v1/poddisruptionbudgets"] = { rows: [], forbidden: "forbidden: pdbs" };
    render(<BlastRadiusPreview cluster="kind-shop" kind="Deployment" obj={deploy} action="delete" />);
    fireEvent.click(screen.getByRole("button", { name: /What this affects/ }));
    expect(screen.getByText(/PodDisruptionBudgets/)).toBeInTheDocument();
    expect(screen.getAllByText(/unknown/i).length).toBeGreaterThan(0);
  });

  it("shows a production warning for a production-looking cluster", () => {
    render(<BlastRadiusPreview cluster="prod-eu" kind="Deployment" obj={deploy} action="delete" />);
    expect(screen.getByText(/looks like production/i)).toBeInTheDocument();
  });

  it("does not subscribe to streams it does not need for a cordon", () => {
    const node = { kind: "Node", metadata: { name: "n1" } };
    render(<BlastRadiusPreview cluster="kind-shop" kind="Node" obj={node} action="cordon" />);
    for (const call of vi.mocked(useResourceStream).mock.calls) {
      expect((call[2] as { enabled?: boolean }).enabled).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: /What this affects/ }));
    expect(screen.getByText(/No new pods are scheduled/)).toBeInTheDocument();
  });
});
