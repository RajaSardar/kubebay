import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { YamlTab } from "../YamlTab";

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="editor" />,
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
