import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NewResourceEditor } from "../NewResourceEditor";
import { api } from "../../lib/api";
import { isEditDirty, resetEditGuard } from "../../lib/editGuard";
import { useTerminalDock } from "../../lib/terminalDock";

// Backlog 51 phase 4: Create Resource as a dock tab, the same editor and templates as the page.
vi.mock("../../lib/monaco", () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <button data-testid="editor" data-value={value} onClick={() => onChange("kind: Pod\n# mine\n")} />
  ),
}));
vi.mock("../../lib/theme", () => ({ useMonacoTheme: () => "vs-dark" }));
vi.mock("../../lib/api", () => ({ api: { createResource: vi.fn() } }));

const renderIt = (p: Partial<React.ComponentProps<typeof NewResourceEditor>> = {}) =>
  render(
    <MemoryRouter>
      <NewResourceEditor cluster="kind-test" guardKey="new/1" variant="dock" {...p} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(api.createResource).mockReset().mockResolvedValue({ applied: 1, total: 1, dryRun: false });
  useTerminalDock.setState({ tabs: [], open: false, activeTab: "shell", sizes: {}, capMessage: null });
});
afterEach(() => resetEditGuard());

describe("NewResourceEditor in the dock", () => {
  it("starts on the template of the requested kind", () => {
    renderIt({ initialKind: "Service" });
    expect((screen.getByLabelText("resource kind") as HTMLSelectElement).value).toBe("Service");
    expect(screen.getByTestId("editor").getAttribute("data-value")).toContain("kind: Service");
  });

  it("starts from given text when it is carried over from the page", () => {
    renderIt({ initialKind: "Pod", initialYaml: "kind: Pod\n# carried\n" });
    expect(screen.getByTestId("editor").getAttribute("data-value")).toContain("# carried");
    expect(isEditDirty("new/1")).toBe(true);
  });

  it("reports an edit to the guard under its own key", () => {
    renderIt();
    expect(isEditDirty("new/1")).toBe(false);
    fireEvent.click(screen.getByTestId("editor"));
    expect(isEditDirty("new/1")).toBe(true);
  });

  it("applies through the create path", async () => {
    renderIt();
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    await screen.findByText(/applied successfully/i);
    expect(api.createResource).toHaveBeenCalledWith(expect.objectContaining({ cluster: "kind-test", dryRun: false }));
  });

  it("asks first on a production-looking cluster", () => {
    renderIt({ cluster: "eks-prod-eu" });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(screen.getByRole("dialog", { name: /apply to production/i })).toBeTruthy();
    expect(api.createResource).not.toHaveBeenCalled();
  });

  it("has no page title and no Open in dock button", () => {
    renderIt();
    expect(screen.queryByRole("button", { name: /open in dock/i })).toBeNull();
    expect(screen.queryByText("Create Resource")).toBeNull();
  });
});

describe("NewResourceEditor on the page", () => {
  it("Open in dock moves the text to a dock tab and resets the page", () => {
    renderIt({ variant: "page", guardKey: "create-resource" });
    fireEvent.click(screen.getByTestId("editor"));
    fireEvent.click(screen.getByRole("button", { name: /open in dock/i }));
    const [tab] = useTerminalDock.getState().tabs;
    expect(tab!.isNew).toBe(true);
    expect(tab!.newYaml).toBe("kind: Pod\n# mine\n");
    expect(isEditDirty("create-resource")).toBe(false);
  });
});
