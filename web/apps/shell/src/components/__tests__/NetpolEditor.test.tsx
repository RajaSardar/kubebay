import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NetpolEditor } from "../NetpolEditor";
import { api } from "../../lib/api";

vi.mock("../../lib/api", () => ({ api: { createResource: vi.fn() } }));

const pods = [
  { metadata: { name: "web", namespace: "shop", labels: { app: "web" } }, spec: { containers: [] }, status: {} },
  { metadata: { name: "db", namespace: "shop", labels: { app: "db" } }, spec: { containers: [] }, status: {} },
];
const namespaces = [{ metadata: { name: "shop" } }, { metadata: { name: "ops" } }];

function setup() {
  render(<NetpolEditor cluster="c1" pods={pods} policies={[]} namespaces={namespaces} />);
  fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "shop" } });
  fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "db-lockdown" } });
  fireEvent.change(screen.getByLabelText("Pod labels"), { target: { value: "app=db" } });
  fireEvent.change(screen.getByLabelText("Ingress"), { target: { value: "deny" } });
}

describe("NetpolEditor", () => {
  beforeEach(() => {
    vi.mocked(api.createResource).mockReset().mockResolvedValue({ applied: 1, total: 1, dryRun: true });
  });

  it("previews the YAML and the impact on live pods before anything is applied", () => {
    setup();
    expect(screen.getByText("Selects 1 pod")).toBeInTheDocument();
    expect(screen.getByText(/kind: "NetworkPolicy"/)).toBeInTheDocument();
    expect(screen.getByText("shop/web → shop/db")).toBeInTheDocument();
    expect(screen.getByText("1 connection blocked")).toBeInTheDocument();
    expect(api.createResource).not.toHaveBeenCalled();
  });

  it("adds an allow rule from another namespace's pods", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Ingress"), { target: { value: "allow" } });
    fireEvent.click(screen.getByRole("button", { name: "Add ingress rule" }));
    fireEvent.change(screen.getByLabelText("Ingress rule 1 peer"), { target: { value: "pods" } });
    fireEvent.change(screen.getByLabelText("Ingress rule 1 namespace"), { target: { value: "ops" } });
    fireEvent.change(screen.getByLabelText("Ingress rule 1 labels"), { target: { value: "app=prom" } });
    fireEvent.change(screen.getByLabelText("Ingress rule 1 ports"), { target: { value: "9090" } });
    expect(screen.getByText(/"kubernetes.io\/metadata.name": "ops"|kubernetes.io\/metadata.name: "ops"/)).toBeInTheDocument();
    expect(screen.getByText(/port: 9090/)).toBeInTheDocument();
  });

  it("shows input errors instead of YAML", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "Bad Name" } });
    expect(screen.getByText("Name must be a lowercase DNS label.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dry run" })).not.toBeInTheDocument();
  });

  it("only allows creating after a server dry run of this exact policy passes", async () => {
    setup();
    expect(screen.queryByRole("button", { name: "Create policy" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await screen.findByText("Dry run passed: the API server accepted this policy.");
    expect(vi.mocked(api.createResource).mock.calls[0]![0]).toMatchObject({ cluster: "c1", dryRun: true });

    fireEvent.click(screen.getByRole("button", { name: "Create policy" }));
    fireEvent.click(screen.getByRole("button", { name: "Create shop/db-lockdown?" }));
    await waitFor(() => expect(api.createResource).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createResource).mock.calls[1]![0]).toMatchObject({ dryRun: false });
    expect(await screen.findByText("Created shop/db-lockdown.")).toBeInTheDocument();
  });

  it("requires a fresh dry run after the draft changes", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await screen.findByText(/Dry run passed/);
    fireEvent.change(screen.getByLabelText("Pod labels"), { target: { value: "app=web" } });
    expect(screen.queryByRole("button", { name: "Create policy" })).not.toBeInTheDocument();
  });

  it("shows the API server's rejection from the dry run", async () => {
    vi.mocked(api.createResource).mockImplementation(async () => {
      throw new Error('admission webhook "policy" denied the request');
    });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    expect(await screen.findByText(/denied the request/)).toBeInTheDocument();
  });

  it("warns that an existing policy with the same name would be replaced", async () => {
    const existing = { metadata: { name: "db-lockdown", namespace: "shop" }, spec: { podSelector: {}, policyTypes: ["Ingress"] } };
    render(<NetpolEditor cluster="c1" pods={pods} policies={[existing]} namespaces={namespaces} />);
    fireEvent.change(screen.getByLabelText("Namespace"), { target: { value: "shop" } });
    fireEvent.change(screen.getByLabelText("Policy name"), { target: { value: "db-lockdown" } });
    fireEvent.change(screen.getByLabelText("Ingress"), { target: { value: "deny" } });
    expect(screen.getByText(/shop\/db-lockdown already exists; creating replaces it/)).toBeInTheDocument();
    expect(screen.getByText(/If another tool \(Helm, kubectl, Argo CD\) manages its rules, the cluster refuses the change/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dry run" }));
    await screen.findByText(/Dry run passed/);
    fireEvent.click(screen.getByRole("button", { name: "Replace policy" }));
    expect(screen.getByRole("button", { name: "Replace shop/db-lockdown?" })).toBeInTheDocument();
  });
});
