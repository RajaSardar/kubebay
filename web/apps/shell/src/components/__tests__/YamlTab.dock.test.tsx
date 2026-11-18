import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { YamlTab } from "../YamlTab";
import { api } from "../../lib/api";
import { resetEditGuard } from "../../lib/editGuard";

// Backlog 51 phase 2: what a YAML tab does when it lives in the dock.
vi.mock("../../lib/monaco", () => ({
  default: ({ onChange }: { onChange: (v: string) => void }) => (
    <button data-testid="editor" onClick={() => onChange("kind: ConfigMap\n# edited\n")} />
  ),
  DiffEditor: () => <div data-testid="diff-editor" />,
}));
vi.mock("../../lib/theme", () => ({ useMonacoTheme: () => "vs-dark" }));
vi.mock("../../lib/api", () => ({
  api: { getYamlText: vi.fn(), applyYaml: vi.fn() },
}));

const props = { cluster: "kind-test", gvr: "v1/configmaps", ns: "default", name: "example" };

beforeEach(() => {
  vi.mocked(api.getYamlText).mockReset().mockResolvedValue("kind: ConfigMap\n");
  vi.mocked(api.applyYaml).mockReset().mockResolvedValue({ changedPaths: ["a"], dryRun: false } as never);
});
afterEach(() => resetEditGuard());

describe("Cmd/Ctrl+S in a dock YAML tab", () => {
  it("applies a dirty edit", async () => {
    render(<YamlTab {...props} dock />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "s", ctrlKey: true });
    await screen.findByText(/Applied: patched/);
    expect(api.applyYaml).toHaveBeenCalledOnce();
  });

  it("does nothing when the editor is clean", async () => {
    render(<YamlTab {...props} dock />);
    fireEvent.keyDown(await screen.findByTestId("editor"), { key: "s", metaKey: true });
    expect(api.applyYaml).not.toHaveBeenCalled();
  });

  it("asks first on a production-looking cluster", async () => {
    render(<YamlTab {...props} cluster="eks-prod-eu" dock />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "s", metaKey: true });
    expect(screen.getByRole("dialog", { name: /apply to production/i })).toBeTruthy();
    expect(api.applyYaml).not.toHaveBeenCalled();
  });

  it("is not bound outside the dock", async () => {
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "s", ctrlKey: true });
    expect(api.applyYaml).not.toHaveBeenCalled();
  });

  it("does not apply while the cluster is offline", async () => {
    render(<YamlTab {...props} dock offline />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.keyDown(screen.getByTestId("editor"), { key: "s", ctrlKey: true });
    expect(api.applyYaml).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /^apply$/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("a dock YAML tab that sits open while the object changes", () => {
  const regainFocus = () => act(async () => void window.dispatchEvent(new Event("focus")));

  it("refreshes silently when the tab is clean", async () => {
    render(<YamlTab {...props} dock watch />);
    await screen.findByTestId("editor");
    vi.mocked(api.getYamlText).mockResolvedValue("kind: ConfigMap\ndata: {a: b}\n");
    await regainFocus();
    expect(screen.queryByText(/changed on the cluster/i)).toBeNull();
    expect(vi.mocked(api.getYamlText)).toHaveBeenCalledTimes(2);
  });

  it("warns and leaves the edit alone when the tab is dirty", async () => {
    render(<YamlTab {...props} dock watch />);
    fireEvent.click(await screen.findByTestId("editor"));
    vi.mocked(api.getYamlText).mockResolvedValue("kind: ConfigMap\ndata: {a: b}\n");
    await regainFocus();
    expect(await screen.findByText(/changed on the cluster since you opened/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show changes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load latest" }));
    await act(async () => {});
    expect(screen.queryByText(/changed on the cluster since you opened/i)).toBeNull();
  });

  it("stays quiet when nothing changed", async () => {
    render(<YamlTab {...props} dock watch />);
    fireEvent.click(await screen.findByTestId("editor"));
    await regainFocus();
    expect(screen.queryByText(/changed on the cluster since you opened/i)).toBeNull();
  });

  it("does not watch when not asked to", async () => {
    render(<YamlTab {...props} dock />);
    await screen.findByTestId("editor");
    await regainFocus();
    expect(vi.mocked(api.getYamlText)).toHaveBeenCalledTimes(1);
  });
});
