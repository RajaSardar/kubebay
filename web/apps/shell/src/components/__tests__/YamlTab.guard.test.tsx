import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { YamlTab } from "../YamlTab";
import { api } from "../../lib/api";
import { anyEditDirty, resetEditGuard } from "../../lib/editGuard";

vi.mock("../../lib/monaco", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button data-testid="editor" onClick={() => onChange("kind: ConfigMap\n# edited\n")} />
  ),
  DiffEditor: () => <div data-testid="diff-editor" />,
}));
vi.mock("../../lib/theme", () => ({ useMonacoTheme: () => "vs-dark" }));
vi.mock("../../lib/api", () => ({
  api: { getYamlText: vi.fn().mockResolvedValue("kind: ConfigMap\n"), applyYaml: vi.fn() },
}));

afterEach(() => {
  resetEditGuard();
  vi.mocked(api.applyYaml).mockReset();
});

const props = { cluster: "kind-test", gvr: "v1/configmaps", ns: "default", name: "example" };

describe("YamlTab unsaved-edit registration", () => {
  it("reports a dirty edit to the guard and clears it on unmount", async () => {
    const { unmount } = render(<YamlTab {...props} />);
    expect(anyEditDirty()).toBe(false);
    fireEvent.click(await screen.findByTestId("editor"));
    expect(anyEditDirty()).toBe(true);
    unmount();
    expect(anyEditDirty()).toBe(false);
  });
});

describe("YamlTab production confirmation on Apply", () => {
  it("asks before applying to a production-looking cluster, and applies only on confirm", async () => {
    vi.mocked(api.applyYaml).mockResolvedValue({ changedPaths: ["a"], dryRun: false } as never);
    render(<YamlTab {...props} cluster="eks-prod-eu" />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(screen.getByRole("dialog", { name: /apply to production/i })).toBeTruthy();
    expect(api.applyYaml).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /apply to eks-prod-eu/i }));
    await screen.findByText(/Applied: patched/);
    expect(api.applyYaml).toHaveBeenCalledOnce();
  });

  it("Cancel on the production prompt applies nothing", async () => {
    render(<YamlTab {...props} cluster="eks-prod-eu" />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.applyYaml).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not ask on a non-production cluster", async () => {
    vi.mocked(api.applyYaml).mockResolvedValue({ changedPaths: ["a"], dryRun: false } as never);
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(screen.queryByRole("dialog", { name: /apply to production/i })).toBeNull();
    await screen.findByText(/Applied: patched/);
  });

  it("does not ask for a Dry-run, which never mutates", async () => {
    vi.mocked(api.applyYaml).mockResolvedValue({ changedPaths: ["a"], dryRun: true } as never);
    render(<YamlTab {...props} cluster="eks-prod-eu" />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /dry-run/i }));
    expect(screen.queryByRole("dialog", { name: /apply to production/i })).toBeNull();
    expect(api.applyYaml).toHaveBeenCalled();
  });
});
