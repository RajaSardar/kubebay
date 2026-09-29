import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import CreateResource from "../CreateResource";
import { api } from "../../lib/api";
import { PolicyRejectionError } from "../../lib/policyRejection";

vi.mock("@monaco-editor/react", () => ({
  default: () => <div data-testid="editor" />,
}));

vi.mock("../../lib/theme", () => ({
  useMonacoTheme: () => "vs-dark",
}));

vi.mock("../../App", () => ({
  useActiveCluster: () => ({ active: "kind-test" }),
}));

vi.mock("../../lib/api", () => ({
  api: { createResource: vi.fn() },
}));

describe("CreateResource — structured policy rejection (backlog #17)", () => {
  it("renders the structured PolicyRejectionCard on a 422 rejection", async () => {
    vi.mocked(api.createResource).mockRejectedValueOnce(
      new PolicyRejectionError({ engine: "kyverno", webhook: "validate.kyverno.svc-fail", message: "label 'team' is required" }),
    );
    render(<MemoryRouter><CreateResource /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(await screen.findByText(/kyverno policy rejected this change/i)).toBeTruthy();
    expect(screen.getByText("validate.kyverno.svc-fail")).toBeTruthy();
  });

  it("still shows a plain error banner for a non-policy failure", async () => {
    vi.mocked(api.createResource).mockRejectedValueOnce(new Error("connection refused"));
    render(<MemoryRouter><CreateResource /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(await screen.findByText(/connection refused/)).toBeTruthy();
  });
});

describe("CreateResource opened from a table's + button", () => {
  it("starts on that table's kind", () => {
    render(
      <MemoryRouter initialEntries={["/create-resource?kind=Service"]}>
        <CreateResource />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText("resource kind") as HTMLSelectElement).value).toBe("Service");
  });

  it("falls back to the first template for an unknown kind", () => {
    render(
      <MemoryRouter initialEntries={["/create-resource?kind=Nope"]}>
        <CreateResource />
      </MemoryRouter>,
    );
    expect((screen.getByLabelText("resource kind") as HTMLSelectElement).value).toBe("Deployment");
  });
});
