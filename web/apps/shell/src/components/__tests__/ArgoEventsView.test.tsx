import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ArgoEventsView } from "../ArgoEventsView";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

const eventSource = {
  metadata: { name: "gh", namespace: "events" },
  spec: { eventBusName: "main", webhook: { push: { port: "12000" } }, calendar: { tick: { interval: "5m" } } },
  status: { conditions: [{ type: "Deployed", status: "True" }] },
};
const sensor = {
  metadata: { name: "on-push", namespace: "events" },
  spec: {
    eventBusName: "main",
    dependencies: [{ name: "d", eventSourceName: "gh", eventName: "push" }],
    triggers: [
      { template: { name: "run-ci", argoWorkflow: { operation: "submit", source: { resource: { kind: "Workflow", metadata: { generateName: "ci-", namespace: "ci" } } } } } },
      { template: { name: "ping", http: { url: "https://x" } } },
      { template: { name: "named", argoWorkflow: { operation: "resubmit", source: { resource: { kind: "Workflow", metadata: { name: "wf-1", namespace: "ci" } } } } } },
    ],
  },
  status: { conditions: [{ type: "Deployed", status: "True" }, { type: "TriggersProvided", status: "False", message: "bad trigger" }] },
};
const bus = {
  metadata: { name: "main", namespace: "events" },
  spec: { jetstream: { replicas: 3 } },
  status: { conditions: [{ type: "Deployed", status: "True" }, { type: "Configured", status: "True" }] },
};

function renderView(over: Partial<Parameters<typeof ArgoEventsView>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ArgoEventsView
        gvrs={{ installed: true, eventSourceGvr: "argoproj.io/v1alpha1/eventsources", sensorGvr: "argoproj.io/v1alpha1/sensors", eventBusGvr: "argoproj.io/v1alpha1/eventbus" }}
        workflowGvr="argoproj.io/v1alpha1/workflows"
        eventSources={[eventSource]}
        sensors={[sensor]}
        eventBuses={[bus]}
        {...over}
      />
    </MemoryRouter>,
  );
}

describe("ArgoEventsView", () => {
  it("lists EventSources with their state and declared event types", () => {
    renderView();
    expect(screen.getByText("gh")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("webhook: push")).toBeTruthy();
    expect(screen.getByText("calendar: tick")).toBeTruthy();
  });

  it("Sensors tab shows state with the failing message, dependencies and triggers", () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: /Sensors/ }));
    expect(screen.getByText("on-push")).toBeTruthy();
    expect(screen.getByText("Not ready")).toBeTruthy();
    expect(screen.getByText(/bad trigger/)).toBeTruthy();
    expect(screen.getByText("gh / push")).toBeTruthy();
    expect(screen.getByText(/run-ci/)).toBeTruthy();
    expect(screen.getByText(/ping/)).toBeTruthy();
    expect(screen.getByText(/http/)).toBeTruthy();
  });

  it("links a trigger that targets a named Workflow to it, and a generated one to the Workflows page", () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: /Sensors/ }));
    fireEvent.click(screen.getByText("wf-1"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/ext--argoproj.io--v1alpha1--workflows/ci/wf-1");
    const generated = screen.getByRole("link", { name: /ci-\*/ });
    expect(generated.getAttribute("href")).toBe("/argo-workflows");
  });

  it("EventBus tab shows backend, replicas and state", () => {
    renderView();
    fireEvent.click(screen.getByRole("radio", { name: /EventBus/ }));
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("jetstream")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
  });

  it("says so when there are no EventSources", () => {
    renderView({ eventSources: [] });
    expect(screen.getByText(/no eventsources/i)).toBeTruthy();
  });
});
