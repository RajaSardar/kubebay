import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreateResource from "../CreateResource";
import { api } from "../../lib/api";
import { resetEditGuard } from "../../lib/editGuard";

vi.mock("../../lib/monaco", () => ({
  default: ({ onChange }: { onChange?: (v: string) => void }) => (
    <button data-testid="editor" onClick={() => onChange?.("kind: ConfigMap\n# edited\n")} />
  ),
}));
vi.mock("../../lib/theme", () => ({ useMonacoTheme: () => "vs-dark" }));
const activeCluster = vi.hoisted(() => ({ id: "kind-test" }));
vi.mock("../../App", () => ({ useActiveCluster: () => ({ active: activeCluster.id }) }));
vi.mock("../../lib/api", () => ({ api: { createResource: vi.fn() } }));

afterEach(() => {
  activeCluster.id = "kind-test";
  resetEditGuard();
  vi.mocked(api.createResource).mockReset();
});

describe("CreateResource production confirmation", () => {
  it("asks before applying to a production-looking cluster", async () => {
    activeCluster.id = "eks-prod-eu";
    vi.mocked(api.createResource).mockResolvedValue({ applied: 1, total: 1 } as never);
    render(<MemoryRouter><CreateResource /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(screen.getByRole("dialog", { name: /apply to production/i })).toBeTruthy();
    expect(api.createResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /apply to eks-prod-eu/i }));
    expect(await screen.findByText(/applied successfully/)).toBeTruthy();
  });

  it("does not ask on a non-production cluster", async () => {
    vi.mocked(api.createResource).mockResolvedValue({ applied: 1, total: 1 } as never);
    render(<MemoryRouter><CreateResource /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByText(/applied successfully/)).toBeTruthy();
  });
});

describe("CreateResource unsaved edits", () => {
  it("switches kind without asking while the YAML is untouched", () => {
    render(<MemoryRouter><CreateResource /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText("resource kind"), { target: { value: "Service" } });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect((screen.getByLabelText("resource kind") as HTMLSelectElement).value).toBe("Service");
  });

  it("asks before a kind switch replaces an edited YAML; Keep editing leaves the kind", () => {
    render(<MemoryRouter><CreateResource /></MemoryRouter>);
    fireEvent.click(screen.getByTestId("editor"));
    fireEvent.change(screen.getByLabelText("resource kind"), { target: { value: "Service" } });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect((screen.getByLabelText("resource kind") as HTMLSelectElement).value).toBe("Deployment");
  });

  it("asks before an in-app link navigates away from an edited YAML", () => {
    render(
      <MemoryRouter>
        <a href="/pods">pods</a>
        <CreateResource />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("editor"));
    fireEvent.click(screen.getByRole("link", { name: "pods" }));
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
  });
});
