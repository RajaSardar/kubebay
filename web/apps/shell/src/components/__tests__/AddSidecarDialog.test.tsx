import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AddSidecarDialog } from "../AddSidecarDialog";
import { ActionsBar } from "../ActionsBar";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

vi.mock("../../lib/monaco", () => ({
  default: () => <div data-testid="editor" />,
  DiffEditor: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="diff-editor" data-original={original} data-modified={modified} />
  ),
}));
vi.mock("../../lib/theme", async () => {
  const actual = await vi.importActual<typeof import("../../lib/theme")>("../../lib/theme");
  return { ...actual, useMonacoTheme: () => "vs-dark" };
});
vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: () => ({ rows: [], synced: true, connected: true }),
}));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { ...actual.api, applyYaml: vi.fn(), getYamlText: vi.fn() } };
});

const deploy = (annotations: Record<string, string> = {}) => ({
  apiVersion: "apps/v1",
  kind: "Deployment",
  metadata: { name: "web", namespace: "shop", annotations },
  spec: { replicas: 2, template: { spec: { containers: [{ name: "app", image: "app:1" }], volumes: [{ name: "config", configMap: { name: "c" } }] } } },
});

function wrap(version: string | undefined, cluster = "kind-shop") {
  const client = new QueryClient();
  client.setQueryData(["clusters"], [{ id: cluster, context: cluster, server: "", status: "reachable", version }]);
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function open(opts: { version?: string; cluster?: string; obj?: Record<string, unknown>; slug?: "deployments" | "cronjobs" } = {}) {
  const onClose = vi.fn();
  const onApplied = vi.fn();
  const cluster = opts.cluster ?? "kind-shop";
  render(
    <AddSidecarDialog slug={opts.slug ?? "deployments"} cluster={cluster} obj={opts.obj ?? deploy()} onClose={onClose} onApplied={onApplied} />,
    { wrapper: wrap(opts.version ?? "v1.30.2", cluster) },
  );
  return { onClose, onApplied };
}

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

beforeEach(() => {
  vi.mocked(api.applyYaml).mockReset();
  vi.mocked(api.getYamlText).mockReset();
  vi.mocked(api.getYamlText).mockResolvedValue("kind: Deployment\n# live\n");
  vi.mocked(api.applyYaml).mockResolvedValue({ applied: true, dryRun: true, resultYaml: "kind: Deployment\n# with sidecar\n" });
});

describe("AddSidecarDialog — presets and form", () => {
  it("opens as a dialog naming the workload, with the presets", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Add sidecar to web" })).toBeInTheDocument();
    for (const p of ["Log shipper", "Debug toolbox", "Cloud SQL proxy", "Custom"]) expect(screen.getByRole("radio", { name: p })).toBeInTheDocument();
  });

  it("a preset fills the form, and the fields stay editable", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: "Debug toolbox" }));
    expect(field("Image").value).toMatch(/^nicolaka\/netshoot/);
    expect(field("Command").value).toBe("sleep infinity");
    fireEvent.change(field("Image"), { target: { value: "busybox:1.36" } });
    expect(field("Image").value).toBe("busybox:1.36");
  });

  it("the log shipper adds a shared emptyDir that the app container also mounts", () => {
    open();
    fireEvent.click(screen.getByRole("radio", { name: "Log shipper" }));
    expect(screen.getByRole("checkbox", { name: "New shared emptyDir" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Also mount in app" })).toBeChecked();
  });

  it("refuses a duplicate container name and cannot be previewed", () => {
    open();
    fireEvent.change(field("Name"), { target: { value: "app" } });
    fireEvent.change(field("Image"), { target: { value: "busybox" } });
    expect(screen.getByText('A container named "app" already exists in this pod template.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toBeDisabled();
  });
});

describe("AddSidecarDialog — native sidecar by cluster version", () => {
  it("offers a native sidecar on 1.29+ and explains the difference", () => {
    open({ version: "v1.29.4" });
    const choice = screen.getByRole("radiogroup", { name: "Sidecar type" });
    expect(choice).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Native sidecar" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/starts before the app containers/)).toBeInTheDocument();
  });

  it("uses a regular container before 1.29 and says why", () => {
    open({ version: "v1.28.9" });
    expect(screen.queryByRole("radiogroup", { name: "Sidecar type" })).toBeNull();
    expect(screen.getByText(/needs Kubernetes 1\.29/)).toBeInTheDocument();
  });
});

describe("AddSidecarDialog — preview, then apply", () => {
  function fillDebug() {
    fireEvent.click(screen.getByRole("radio", { name: "Debug toolbox" }));
  }

  it("warns about the rollout restart and shows what it affects", () => {
    open();
    expect(screen.getByText(/triggers a rollout restart/)).toBeInTheDocument();
    expect(screen.getByText("What this affects")).toBeInTheDocument();
  });

  it("dry-runs the strategic patch, shows the diff, and applies only on a second click", async () => {
    const { onApplied } = open();
    fillDebug();
    const apply = screen.getByRole("button", { name: "Add sidecar" });
    expect(apply).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    const diff = await screen.findByTestId("diff-editor");
    expect(diff.dataset.original).toContain("# live");
    expect(diff.dataset.modified).toContain("# with sidecar");
    expect(api.applyYaml).toHaveBeenCalledTimes(1);
    const req = vi.mocked(api.applyYaml).mock.calls[0]![0];
    expect(req).toMatchObject({ cluster: "kind-shop", gvr: "apps/v1/deployments", ns: "shop", name: "web", dryRun: true, mode: "strategic", action: "add-sidecar" });
    const patch = JSON.parse(req.yaml);
    expect(patch.spec.template.spec.initContainers[0]).toMatchObject({ name: "debug-toolbox", restartPolicy: "Always" });
    expect(patch.spec.template.spec.containers).toBeUndefined();

    vi.mocked(api.applyYaml).mockResolvedValueOnce({ applied: true, dryRun: false });
    fireEvent.click(screen.getByRole("button", { name: "Add sidecar" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(api.applyYaml).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.applyYaml).mock.calls[1]![0]).toMatchObject({ dryRun: false, mode: "strategic", action: "add-sidecar", yaml: req.yaml });
  });

  it("an edit after the preview needs a new preview", async () => {
    open();
    fillDebug();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("diff-editor");
    expect(screen.getByRole("button", { name: "Add sidecar" })).not.toBeDisabled();
    fireEvent.change(field("Image"), { target: { value: "busybox:1.36" } });
    expect(screen.getByRole("button", { name: "Add sidecar" })).toBeDisabled();
  });

  it("asks before applying to a cluster that looks like production", async () => {
    const { onApplied } = open({ cluster: "prod-eu" });
    fillDebug();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("diff-editor");
    fireEvent.click(screen.getByRole("button", { name: "Add sidecar" }));
    expect(await screen.findByRole("dialog", { name: "Apply to production?" })).toBeInTheDocument();
    expect(api.applyYaml).toHaveBeenCalledTimes(1);
    vi.mocked(api.applyYaml).mockResolvedValueOnce({ applied: true, dryRun: false });
    fireEvent.click(screen.getByRole("button", { name: "Apply to prod-eu" }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(vi.mocked(api.applyYaml).mock.calls[1]![0]).toMatchObject({ dryRun: false });
  });

  it("shows a policy rejection and stays open", async () => {
    const { onApplied, onClose } = open();
    fillDebug();
    vi.mocked(api.applyYaml).mockRejectedValueOnce(new PolicyRejectionError({ engine: "kyverno", webhook: "w", message: "images must be signed" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(/images must be signed/)).toBeInTheDocument();
    expect(onApplied).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("warns that a GitOps controller will revert it, and the patch carries the owner for the audit log", async () => {
    open({ obj: deploy({ "argocd.argoproj.io/instance": "shop-app" }) });
    expect(screen.getByText(/Argo CD \(shop-app\) manages this resource/)).toBeInTheDocument();
    fillDebug();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByTestId("diff-editor");
    const patch = JSON.parse(vi.mocked(api.applyYaml).mock.calls[0]![0].yaml);
    expect(patch.metadata.annotations).toEqual({ "argocd.argoproj.io/instance": "shop-app" });
  });
});

describe("ActionsBar — Add sidecar", () => {
  const renderBar = (slug: "deployments" | "cronjobs" | "nodes") =>
    render(<ActionsBar slug={slug} cluster="kind-shop" ns="shop" name="web" obj={deploy()} />, { wrapper: wrap("v1.30.0") });

  it("is offered for workloads and CronJobs, not Nodes", () => {
    renderBar("nodes");
    expect(screen.queryByRole("button", { name: "Add sidecar" })).toBeNull();
  });

  it("opens the dialog from the drawer", () => {
    renderBar("deployments");
    fireEvent.click(screen.getByRole("button", { name: "Add sidecar" }));
    expect(screen.getByRole("dialog", { name: "Add sidecar to web" })).toBeInTheDocument();
  });

  it("is on a CronJob too", () => {
    renderBar("cronjobs");
    expect(screen.getByRole("button", { name: "Add sidecar" })).toBeInTheDocument();
  });
});
