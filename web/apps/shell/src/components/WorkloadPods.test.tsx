import { beforeEach, describe, expect, it, vi } from "vitest";
import { podNameText } from "../testing/podName";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkloadPods } from "./WorkloadPods";

// Backlog 75: the Pods section at the bottom of a workload's Summary.
const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => ({
  ...(await vi.importActual<typeof import("react-router-dom")>("react-router-dom")),
  useNavigate: () => navigateMock,
}));

const calls: { gvr: string; opts: Record<string, unknown> }[] = [];
let byGvr: Record<string, Record<string, unknown>[]> = {};
let synced = true;
vi.mock("../lib/useResourceStream", () => ({
  useResourceStream: (_c: string, gvr: string, opts: Record<string, unknown>) => {
    calls.push({ gvr, opts });
    return { rows: byGvr[gvr] ?? [], synced, connected: true };
  },
}));

const owner = { kind: "StatefulSet", name: "db", uid: "u1", controller: true };
const mk = (name: string) => ({
  metadata: { name, namespace: "shop", creationTimestamp: "2026-01-01T00:00:00Z", resourceVersion: "1", ownerReferences: [owner] },
  spec: { nodeName: "node-a", containers: [{ name: "c" }] },
  status: { phase: "Running", containerStatuses: [{ name: "c", ready: true, restartCount: 3 }] },
});
const sts = { kind: "StatefulSet", metadata: { name: "db", namespace: "shop", uid: "u1" }, spec: { selector: { matchLabels: { app: "db" } } } };

function draw(obj: Record<string, unknown> = sts) {
  return render(
    <MemoryRouter>
      <WorkloadPods cluster="kind-test" obj={obj} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  calls.length = 0;
  byGvr = {};
  synced = true;
  navigateMock.mockClear();
});

describe("WorkloadPods", () => {
  it("lists the workload's pods with ready, status, restarts and node, and opens a pod on click", () => {
    byGvr["v1/pods"] = [mk("db-0"), mk("db-1")];
    draw();
    expect(screen.getByText("Pods (2)")).toBeInTheDocument();
    expect(screen.getByText(podNameText("db-0"))).toBeInTheDocument();
    expect(screen.getAllByText("node-a")).toHaveLength(2);
    expect(screen.getAllByText("1/1")).toHaveLength(2);
    fireEvent.click(screen.getByText(podNameText("db-1")));
    expect(navigateMock).toHaveBeenCalledWith("/detail/pods/shop/db-1");
    const call = calls.find((c) => c.gvr === "v1/pods")!;
    expect(call.opts).toMatchObject({ ns: ["shop"], labelSelector: "app=db", mode: "full" });
  });

  it("says so when the workload has no pods", () => {
    draw();
    expect(screen.getByText("Pods (0)")).toBeInTheDocument();
    expect(screen.getByText(/No pods/)).toBeInTheDocument();
  });

  it("shows the first 50 of many pods and a button for the rest", () => {
    byGvr["v1/pods"] = Array.from({ length: 120 }, (_, i) => mk(`db-${String(i).padStart(3, "0")}`));
    draw();
    expect(screen.getByText("Pods (120)")).toBeInTheDocument();
    expect(screen.queryByText(podNameText("db-060"))).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 120 pods" }));
    expect(screen.getByText(podNameText("db-060"))).toBeInTheDocument();
  });

  it("reads ReplicaSets for a Deployment", () => {
    draw({ kind: "Deployment", metadata: { name: "web", namespace: "shop", uid: "d1" }, spec: { selector: { matchLabels: { app: "web" } } } });
    expect(calls.some((c) => c.gvr === "apps/v1/replicasets")).toBe(true);
  });
});
