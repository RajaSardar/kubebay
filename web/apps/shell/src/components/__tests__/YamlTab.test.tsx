import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { YamlTab } from "../YamlTab";
import { api } from "../../lib/api";
import { PolicyRejectionError, StaleEditError } from "../../lib/policyRejection";

vi.mock("@monaco-editor/react", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button data-testid="editor" onClick={() => onChange("kind: ConfigMap\nmetadata:\n  name: example\n  # edited\n")} />
  ),
  DiffEditor: () => <div data-testid="diff-editor" />,
}));

vi.mock("../../lib/theme", () => ({
  useMonacoTheme: () => "vs-dark",
}));

vi.mock("../../lib/api", () => ({
  api: {
    getYamlText: vi.fn().mockResolvedValue("kind: ConfigMap\nmetadata:\n  name: example\n"),
    applyYaml: vi.fn(),
  },
}));

const props = { cluster: "kind-test", gvr: "v1/configmaps", ns: "default", name: "example" };

describe("YamlTab — GitOps ownership warning", () => {
  it("shows no warning when the resource has no GitOps owner", async () => {
    render(<YamlTab {...props} />);
    expect(await screen.findByTestId("editor")).toBeTruthy();
    expect(screen.queryByText(/manages this resource/)).toBeNull();
  });

  it("warns before Apply when the resource is Argo CD-managed", async () => {
    render(<YamlTab {...props} gitopsOwner={{ controller: "argocd", name: "my-app" }} />);
    expect(await screen.findByTestId("editor")).toBeTruthy();
    const warning = screen.getByText(/manages this resource/);
    expect(warning.textContent).toContain("Argo CD");
    expect(warning.textContent).toContain("my-app");
  });

  it("warns before Apply when the resource is Flux-managed", async () => {
    render(<YamlTab {...props} gitopsOwner={{ controller: "flux", name: "my-kustomization" }} />);
    expect(await screen.findByTestId("editor")).toBeTruthy();
    const warning = screen.getByText(/manages this resource/);
    expect(warning.textContent).toContain("Flux");
    expect(warning.textContent).toContain("my-kustomization");
  });
});

describe("YamlTab — revert unsaved edits", () => {
  it("disables Revert when there are no unsaved edits", async () => {
    render(<YamlTab {...props} />);
    await screen.findByTestId("editor");
    expect(screen.getByRole("button", { name: /revert/i })).toBeDisabled();
  });

  it("discards the in-progress edit locally, with no extra network call", async () => {
    render(<YamlTab {...props} />);
    const editor = await screen.findByTestId("editor");
    const callsBefore = vi.mocked(api.getYamlText).mock.calls.length;

    fireEvent.click(editor);
    expect(screen.getByText("modified")).toBeTruthy();
    expect(screen.getByRole("button", { name: /revert/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /revert/i }));
    expect(screen.queryByText("modified")).toBeNull();
    expect(screen.getByRole("button", { name: /revert/i })).toBeDisabled();
    // Reverting is a local reset, not a reload.
    expect(vi.mocked(api.getYamlText).mock.calls.length).toBe(callsBefore);
  });
});

describe("YamlTab — impact banner", () => {
  it("renders the caller-supplied impact banner", async () => {
    render(<YamlTab {...props} impactBanner={<div>backs 3 nodes / 12 pods</div>} />);
    await screen.findByTestId("editor");
    expect(screen.getByText("backs 3 nodes / 12 pods")).toBeTruthy();
  });

  it("renders nothing extra when no impact banner is supplied", async () => {
    render(<YamlTab {...props} />);
    await screen.findByTestId("editor");
    expect(screen.queryByText(/backs/)).toBeNull();
  });
});

describe("YamlTab — dangerous-change type-to-confirm gate", () => {
  it("does not gate Apply when dangerousChangeCheck finds nothing", async () => {
    render(<YamlTab {...props} dangerousChangeCheck={() => []} />);
    const editor = await screen.findByTestId("editor");
    fireEvent.click(editor);
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });

  it("disables Apply (but not Dry-run) until the resource name is typed to confirm", async () => {
    render(
      <YamlTab
        {...props}
        dangerousChangeCheck={() => [{ message: "spec.limits.cpu is shrinking" }]}
      />,
    );
    const editor = await screen.findByTestId("editor");
    fireEvent.click(editor);

    expect(await screen.findByText(/spec\.limits\.cpu is shrinking/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /dry-run/i })).not.toBeDisabled();

    const confirmInput = screen.getByPlaceholderText(props.name);
    fireEvent.change(confirmInput, { target: { value: "wrong-name" } });
    expect(screen.getByRole("button", { name: /^apply$/i })).toBeDisabled();

    fireEvent.change(confirmInput, { target: { value: props.name } });
    expect(screen.getByRole("button", { name: /^apply$/i })).not.toBeDisabled();
  });
});

describe("YamlTab — structured policy rejection", () => {
  it("renders a pre-flight card with the engine, webhook, and message on a policy rejection", async () => {
    vi.mocked(api.applyYaml).mockRejectedValueOnce(
      new PolicyRejectionError({
        engine: "kyverno",
        webhook: "validate.kyverno.svc-fail",
        message: "label 'team' is required",
        causes: [{ field: "metadata.labels.team", message: "is required" }],
      }),
    );
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /dry-run/i }));

    expect(await screen.findByText(/label 'team' is required/)).toBeTruthy();
    expect(screen.getByText(/kyverno policy rejected this change/i)).toBeTruthy();
    expect(screen.getByText(/metadata\.labels\.team/)).toBeTruthy();
  });

  it("clears the pre-flight card once the user edits the YAML again", async () => {
    vi.mocked(api.applyYaml).mockRejectedValueOnce(
      new PolicyRejectionError({ engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label required" }),
    );
    render(<YamlTab {...props} />);
    const editor = await screen.findByTestId("editor");
    fireEvent.click(editor);
    fireEvent.click(screen.getByRole("button", { name: /dry-run/i }));
    await screen.findByText(/label required/);

    fireEvent.click(editor);
    expect(screen.queryByText(/label required/)).toBeNull();
  });

  it("falls back to the plain error message for a non-policy apply failure", async () => {
    vi.mocked(api.applyYaml).mockRejectedValueOnce(new Error("apply: connection refused"));
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /dry-run/i }));

    expect(await screen.findByText(/connection refused/)).toBeTruthy();
  });
});

describe("YamlTab — edits are patched, not server-side applied", () => {
  it("sends the YAML it loaded as the original, so only edited fields are patched", async () => {
    vi.mocked(api.applyYaml).mockResolvedValueOnce({ applied: true, dryRun: false, patchType: "strategic", changedPaths: ["data.k"] });
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Applied: patched 1 field.")).toBeTruthy();
    const req = vi.mocked(api.applyYaml).mock.calls.at(-1)![0];
    expect(req.original).toBe("kind: ConfigMap\nmetadata:\n  name: example\n");
    expect(req.yaml).toContain("# edited");
  });

  it("says when an edit changed nothing the cluster stores", async () => {
    vi.mocked(api.applyYaml).mockResolvedValueOnce({ applied: false, dryRun: false, noop: true, changedPaths: [] });
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Nothing to apply: no stored field changed.")).toBeTruthy();
  });

  it("tells the user a Helm upgrade or rollback will restore the chart's values", async () => {
    render(<YamlTab {...props} helmRelease="api-consumers-in" />);
    await screen.findByTestId("editor");
    const banner = screen.getByText(/Helm release/);
    expect(banner.textContent).toContain("api-consumers-in");
    expect(banner.textContent).toMatch(/next helm upgrade or rollback/i);
  });
});

describe("YamlTab — stale edits", () => {
  it("names the fields that changed on the cluster and offers a reload instead of overwriting", async () => {
    vi.mocked(api.applyYaml).mockRejectedValueOnce(new StaleEditError(["spec.template.spec.containers[name=app].env[name=REGION].value"]));
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText(/changed on the cluster since you opened this editor/)).toBeTruthy();
    expect(screen.getByText("spec.template.spec.containers[name=app].env[name=REGION].value")).toBeTruthy();
    const calls = vi.mocked(api.getYamlText).mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Reload current version" }));
    expect(vi.mocked(api.getYamlText).mock.calls.length).toBe(calls + 1);
  });
});

