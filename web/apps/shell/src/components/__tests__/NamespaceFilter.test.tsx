import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NamespaceFilter } from "../NamespaceFilter";

const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("../../lib/useResourceStream", () => ({ useResourceStream: () => ({ rows: rows.value, synced: true }) }));

const ns = (name: string, project?: string) => ({
  metadata: { name, annotations: project ? { "field.cattle.io/projectId": `c-m-abc12:${project}` } : {} },
});

describe("NamespaceFilter", () => {
  it("groups namespaces by Rancher project when the cluster has projects (KB-08)", () => {
    rows.value = [ns("shop", "p-b"), ns("kube-system"), ns("api", "p-b"), ns("cattle-system", "p-a")];
    render(<NamespaceFilter cluster="prod" />);
    fireEvent.click(screen.getByRole("button", { name: /All namespaces/ }));
    const b = screen.getByRole("group", { name: "Project p-b" });
    expect(within(b).getAllByRole("option").map((o) => o.textContent)).toEqual(["api", "shop"]);
    expect(within(screen.getByRole("group", { name: "Not in a project" })).getByRole("option", { name: /kube-system/ })).toBeInTheDocument();
  });

  it("stays a flat list without projects", () => {
    rows.value = [ns("b"), ns("a")];
    render(<NamespaceFilter cluster="dev" />);
    fireEvent.click(screen.getByRole("button", { name: /All namespaces/ }));
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
    expect(screen.getAllByRole("option").slice(1).map((o) => o.textContent)).toEqual(["a", "b"]);
  });
});
