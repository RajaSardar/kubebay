import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { YamlTab } from "../YamlTab";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

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
