import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { api } from "../../lib/api";
import { ArgoWorkflowsView } from "../ArgoWorkflowsView";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    api: {
      ...actual.api,
      applyYaml: vi.fn().mockResolvedValue({ applied: true, dryRun: false }),
      createResource: vi.fn().mockResolvedValue({ applied: 1, total: 1, dryRun: false }),
    },
  };
});

const NOW = new Date("2026-11-19T12:00:00Z");

const GVRS = {
  installed: true,
  workflowGvr: "argoproj.io/v1alpha1/workflows",
  templateGvr: "argoproj.io/v1alpha1/workflowtemplates",
  clusterTemplateGvr: "argoproj.io/v1alpha1/clusterworkflowtemplates",
  cronGvr: "argoproj.io/v1alpha1/cronworkflows",
};

const running = {
  apiVersion: "argoproj.io/v1alpha1",
  kind: "Workflow",
  metadata: { name: "build-1", namespace: "ci" },
  spec: { entrypoint: "main" },
  status: {
    phase: "Running",
    progress: "1/2",
    startedAt: "2026-11-19T11:58:00Z",
    nodes: {
      "build-1": { id: "build-1", name: "build-1", displayName: "build-1", type: "DAG", phase: "Running", children: ["n1", "n2"] },
      n1: { id: "n1", name: "build-1.a", displayName: "compile", type: "Pod", phase: "Succeeded" },
      n2: { id: "n2", name: "build-1.b", displayName: "test", type: "Pod", phase: "Failed", message: "exit code 2" },
    },
  },
};
const failed = {
  metadata: { name: "build-0", namespace: "ci" },
  spec: {},
  status: { phase: "Failed", progress: "0/1", startedAt: "2026-11-19T10:00:00Z", finishedAt: "2026-11-19T10:01:00Z" },
};
const pod = {
  metadata: {
    name: "build-1-test-77",
    namespace: "ci",
    labels: { "workflows.argoproj.io/workflow": "build-1" },
    annotations: { "workflows.argoproj.io/node-name": "build-1.b" },
  },
};

function renderView(over: Partial<Parameters<typeof ArgoWorkflowsView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ArgoWorkflowsView
        cluster="kind-test"
        gvrs={GVRS}
        workflows={[running, failed]}
        templates={[{ metadata: { name: "tpl", namespace: "ci" }, spec: { entrypoint: "main", templates: [{}] } }]}
        clusterTemplates={[{ metadata: { name: "ctpl" }, spec: { templates: [{}, {}] } }]}
        crons={[
          { metadata: { name: "nightly", namespace: "ci" }, spec: { schedule: "0 13 * * *" } },
          { metadata: { name: "paused", namespace: "ci" }, spec: { schedule: "0 13 * * *", suspend: true } },
        ]}
        pods={[pod]}
        now={NOW}
        {...over}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(api.applyYaml).mockClear();
  vi.mocked(api.createResource).mockClear();
});

describe("ArgoWorkflowsView", () => {
  it("lists workflows with phase, progress and duration", () => {
    renderView();
    expect(screen.getByText("build-1")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("1m 0s")).toBeTruthy();
  });

  it("shows the node tree with phases, messages and a pod link in the detail", () => {
    renderView();
    fireEvent.click(screen.getByText("build-1"));
    expect(screen.getByText("compile")).toBeTruthy();
    expect(screen.getByText("test")).toBeTruthy();
    expect(screen.getByText("exit code 2")).toBeTruthy();
    expect(screen.getByText("build-1-test-77")).toBeTruthy();
  });

  it("stops a running workflow only after a second confirming click", async () => {
    renderView();
    fireEvent.click(screen.getByText("build-1"));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(api.applyYaml).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /confirm stop/i }));
    await waitFor(() => expect(api.applyYaml).toHaveBeenCalledTimes(1));
    const body = vi.mocked(api.applyYaml).mock.calls[0]![0];
    expect(body).toMatchObject({ cluster: "kind-test", ns: "ci", name: "build-1", mode: "merge", action: "argo-workflow-stop" });
    expect(JSON.parse(body.yaml).spec).toEqual({ shutdown: "Stop" });
  });

  it("offers only Resubmit on a finished workflow and creates a new one with generateName", async () => {
    renderView();
    fireEvent.click(screen.getByText("build-0"));
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resubmit" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm resubmit/i }));
    await waitFor(() => expect(api.createResource).toHaveBeenCalledTimes(1));
    const call = vi.mocked(api.createResource).mock.calls[0]![0];
    expect(call.cluster).toBe("kind-test");
    expect(call.dryRun).toBe(false);
    expect(JSON.parse(call.yaml).metadata.generateName).toBe("build-0-");
  });

  it("shows a failed action's error", async () => {
    vi.mocked(api.applyYaml).mockRejectedValueOnce(new Error("forbidden"));
    renderView();
    fireEvent.click(screen.getByText("build-1"));
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    fireEvent.click(screen.getByRole("button", { name: /confirm suspend/i }));
    await waitFor(() => expect(screen.getByText(/forbidden/)).toBeTruthy());
  });

  it("CronWorkflows tab shows schedule, next run and suspended state", () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: /CronWorkflows/ }));
    expect(screen.getByText("nightly")).toBeTruthy();
    expect(screen.getAllByText("0 13 * * *")).toHaveLength(2);
    expect(screen.getByText("in 1h")).toBeTruthy();
    expect(screen.getByText("Suspended")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Resume" })).toBeTruthy();
  });

  it("template tabs list templates", () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: /^WorkflowTemplates/ }));
    expect(screen.getByText("tpl")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /ClusterWorkflowTemplates/ }));
    expect(screen.getByText("ctpl")).toBeTruthy();
  });

  it("says so when there are no workflows", () => {
    renderView({ workflows: [] });
    expect(screen.getByText(/no workflows/i)).toBeTruthy();
  });
});
