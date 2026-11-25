import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { GitOpsActionsBar } from "../GitOpsActionsBar";
import { api } from "../../lib/api";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, applyYaml: vi.fn().mockResolvedValue({ applied: true, dryRun: false }) } };
});

const KS = "kustomize.toolkit.fluxcd.io/v1/kustomizations";
const APPS = "argoproj.io/v1alpha1/applications";
const apply = api.applyYaml as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => apply.mockClear());

describe("GitOpsActionsBar: Flux", () => {
  const ks = { metadata: { name: "apps", namespace: "flux-system" }, spec: {}, status: { inventory: { entries: [{ id: "a" }] } } };

  it("reconciles after a confirmation, with no GitOps warning", async () => {
    render(<GitOpsActionsBar cluster="kind-test" gvr={KS} ns="flux-system" name="apps" obj={ks} />);
    expect(screen.queryByText(/will likely revert/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    expect(screen.getByText(/manages 1 resource/)).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reconcile now" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(apply.mock.calls[0]![0]).toMatchObject({ gvr: KS, ns: "flux-system", name: "apps", action: "flux-reconcile", mode: "merge" });
  });

  it("shows a Suspended pill and offers only Resume", async () => {
    render(<GitOpsActionsBar cluster="kind-test" gvr={KS} ns="flux-system" name="apps" obj={{ ...ks, spec: { suspend: true } }} />);
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconcile" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Resume now" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    expect(JSON.parse(apply.mock.calls[0]![0].yaml).spec).toEqual({ suspend: false });
  });

  it("asks again on a cluster that looks like production, naming it", async () => {
    render(<GitOpsActionsBar cluster="prod-eu" gvr={KS} ns="flux-system" name="apps" obj={ks} />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(screen.getByText(/looks like a production cluster/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Suspend on prod-eu" }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it("shows the reason when the request is refused", async () => {
    apply.mockRejectedValueOnce(new Error("forbidden: cannot patch kustomizations"));
    render(<GitOpsActionsBar cluster="kind-test" gvr={KS} ns="flux-system" name="apps" obj={ks} />);
    fireEvent.click(screen.getByRole("button", { name: "Reconcile" }));
    fireEvent.click(screen.getByRole("button", { name: "Reconcile now" }));
    expect(await screen.findByText(/cannot patch kustomizations/)).toBeInTheDocument();
  });

  it("renders nothing for a kind with no GitOps action", () => {
    const { container } = render(<GitOpsActionsBar cluster="c" gvr="apps/v1/deployments" ns="d" name="x" obj={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("GitOpsActionsBar: Argo CD rollback", () => {
  const history = [
    { id: 1, revision: "aaaa111", deployedAt: "2026-01-01T00:00:00Z" },
    { id: 2, revision: "bbbb222", deployedAt: "2026-02-01T00:00:00Z" },
  ];
  const app = { metadata: { name: "web", namespace: "argocd" }, spec: { syncPolicy: {} }, status: { history } };

  it("refuses under automated sync and offers to show the policy", () => {
    const auto = { ...app, spec: { syncPolicy: { automated: { prune: true } } } };
    render(<GitOpsActionsBar cluster="kind-test" gvr={APPS} ns="argocd" name="web" obj={auto} />);
    fireEvent.click(screen.getByRole("button", { name: "Rollback" }));
    expect(screen.getByText(/reverted immediately/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Roll back to/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sync policy" }));
    expect(screen.getByText(/"automated"/)).toBeInTheDocument();
  });

  it("needs the app name typed, then patches operation.sync with the chosen revision", async () => {
    render(<GitOpsActionsBar cluster="kind-test" gvr={APPS} ns="argocd" name="web" obj={app} />);
    fireEvent.click(screen.getByRole("button", { name: "Rollback" }));
    // Defaults to the entry before the latest one.
    const go = screen.getByRole("button", { name: "Roll back to aaaa111" });
    expect(go).toBeDisabled();
    fireEvent.change(screen.getByLabelText("History entry"), { target: { value: "2" } });
    fireEvent.click(screen.getByLabelText("Prune resources the revision does not define"));
    fireEvent.change(screen.getByLabelText("Type web to confirm"), { target: { value: "web" } });
    const go1 = screen.getByRole("button", { name: "Roll back to bbbb222" });
    expect(go1).toBeEnabled();
    fireEvent.click(go1);
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    const req = apply.mock.calls[0]![0];
    expect(req.action).toBe("argocd-rollback");
    expect(JSON.parse(req.yaml).operation.sync).toMatchObject({ revision: "bbbb222", prune: true });
  });
});
