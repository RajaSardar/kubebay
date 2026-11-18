import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { YamlTab } from "../YamlTab";
import { api, ObjectNotFoundError } from "../../lib/api";
import { resetEditGuard } from "../../lib/editGuard";
import { readDraft, writeDraft } from "../../lib/editRecovery";

// Backlog 51 phase 3: restore of unsaved text, and the deleted-object state.
vi.mock("../../lib/monaco", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button data-testid="editor" data-value={value} onClick={() => onChange("kind: ConfigMap\n# edited\n")} />
  ),
  DiffEditor: () => <div data-testid="diff-editor" />,
}));
vi.mock("../../lib/theme", () => ({ useMonacoTheme: () => "vs-dark" }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, api: { getYamlText: vi.fn(), applyYaml: vi.fn(), createResource: vi.fn() } };
});

const props = { cluster: "kind-test", gvr: "v1/configmaps", ns: "default", name: "example" };
const key = "kind-test/v1/configmaps/default/example";
const LIVE = "kind: ConfigMap\n";

beforeEach(() => {
  sessionStorage.clear();
  vi.mocked(api.getYamlText).mockReset().mockResolvedValue(LIVE);
  vi.mocked(api.applyYaml).mockReset().mockResolvedValue({ changedPaths: ["a"], dryRun: false } as never);
  vi.mocked(api.createResource).mockReset().mockResolvedValue({ applied: 1, total: 1, dryRun: false });
});
afterEach(() => resetEditGuard());

describe("restore of unsaved text", () => {
  it("keeps a dirty edit as a draft while you type", async () => {
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    expect(readDraft(key)?.text).toBe("kind: ConfigMap\n# edited\n");
    expect(readDraft(key)?.original).toBe(LIVE);
  });

  it("offers Restore unsaved edit when a draft exists, and puts the text back", async () => {
    writeDraft(key, { text: "kind: ConfigMap\n# from before the reload\n", original: LIVE });
    render(<YamlTab {...props} />);
    const restore = await screen.findByRole("button", { name: /restore unsaved edit/i });
    expect(screen.getByTestId("editor").getAttribute("data-value")).toBe(LIVE); // not restored on its own
    fireEvent.click(restore);
    expect(screen.getByTestId("editor").getAttribute("data-value")).toContain("from before the reload");
    expect(screen.queryByRole("button", { name: /restore unsaved edit/i })).toBeNull();
    expect(screen.getByText("modified")).toBeTruthy();
  });

  it("Discard drops the draft", async () => {
    writeDraft(key, { text: "kind: ConfigMap\n# old\n", original: LIVE });
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByRole("button", { name: /discard saved edit/i }));
    expect(readDraft(key)).toBeNull();
    expect(screen.queryByRole("button", { name: /restore unsaved edit/i })).toBeNull();
  });

  it("does not offer a draft that equals the live text", async () => {
    writeDraft(key, { text: LIVE, original: LIVE });
    render(<YamlTab {...props} />);
    await screen.findByTestId("editor");
    expect(screen.queryByRole("button", { name: /restore unsaved edit/i })).toBeNull();
  });

  it("clears the draft once the edit is applied", async () => {
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    await screen.findByText(/Applied: patched/);
    expect(readDraft(key)).toBeNull();
  });

  it("clears the draft on Revert", async () => {
    render(<YamlTab {...props} />);
    fireEvent.click(await screen.findByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /^revert$/i }));
    expect(readDraft(key)).toBeNull();
  });

  it("never keeps a Secret", async () => {
    render(<YamlTab {...props} gvr="v1/secrets" name="s" />);
    fireEvent.click(await screen.findByTestId("editor"));
    expect(sessionStorage.length).toBe(0);
  });
});

describe("an object deleted while its tab is open", () => {
  const regainFocus = () => act(async () => void window.dispatchEvent(new Event("focus")));
  async function openAndDelete(extra: object = {}) {
    render(<YamlTab {...props} dock watch {...extra} />);
    fireEvent.click(await screen.findByTestId("editor"));
    vi.mocked(api.getYamlText).mockRejectedValue(new ObjectNotFoundError("not found"));
    await regainFocus();
  }

  it("says so, disables Apply and Dry-run, and keeps the text", async () => {
    await openAndDelete();
    expect(screen.getByText(/deleted on the cluster/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^apply$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^dry-run$/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("editor").getAttribute("data-value")).toContain("# edited");
  });

  it("does not claim a deletion when the cluster is merely unreachable", async () => {
    render(<YamlTab {...props} dock watch />);
    fireEvent.click(await screen.findByTestId("editor"));
    vi.mocked(api.getYamlText).mockRejectedValue(new Error("connection refused"));
    await regainFocus();
    expect(screen.queryByText(/deleted on the cluster/i)).toBeNull();
  });

  it("Re-create from this text goes through the create path with the edited text", async () => {
    await openAndDelete();
    vi.mocked(api.getYamlText).mockResolvedValue("kind: ConfigMap\n# edited\n");
    fireEvent.click(screen.getByRole("button", { name: /re-create from this text/i }));
    await screen.findByText(/re-created/i);
    expect(api.createResource).toHaveBeenCalledWith({ cluster: "kind-test", yaml: "kind: ConfigMap\n# edited\n", dryRun: false });
    expect(screen.queryByText(/deleted on the cluster/i)).toBeNull();
  });

  it("asks first on a production-looking cluster", async () => {
    render(<YamlTab {...props} cluster="eks-prod-eu" dock watch />);
    fireEvent.click(await screen.findByTestId("editor"));
    vi.mocked(api.getYamlText).mockRejectedValue(new ObjectNotFoundError("gone"));
    await regainFocus();
    fireEvent.click(screen.getByRole("button", { name: /re-create from this text/i }));
    expect(screen.getByRole("dialog", { name: /apply to production/i })).toBeTruthy();
    expect(api.createResource).not.toHaveBeenCalled();
  });

  it("shows the state when Reload finds the object gone", async () => {
    render(<YamlTab {...props} />);
    await screen.findByTestId("editor");
    vi.mocked(api.getYamlText).mockRejectedValue(new ObjectNotFoundError("gone"));
    fireEvent.click(screen.getByRole("button", { name: /^reload$/i }));
    await screen.findByText(/deleted on the cluster/i);
  });
});
