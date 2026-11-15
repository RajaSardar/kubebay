import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import Crds from "../Crds";

vi.mock("../../lib/useCluster", () => ({ useCluster: () => ({ cluster: "kind-a" }) }));
vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    crdApi: {
      list: async () => [
        { name: "applications.argoproj.io", group: "argoproj.io", version: "v1alpha1", resource: "applications", kind: "Application", namespaced: true, gvr: "argoproj.io/v1alpha1/applications", columns: [] },
        { name: "x.example.com", group: "example.com", version: "v1", resource: "xs", kind: "X", namespaced: false, gvr: "example.com/v1/xs", columns: [] },
      ],
    },
  };
});

beforeEach(() => localStorage.clear());

function renderCrds(initial = "/crds") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Crds />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Crds favorites", () => {
  it("stars a single CRD with its scope preserved, and unstars it", async () => {
    renderCrds();
    fireEvent.click(await screen.findByRole("button", { name: "Add Application to favorites" }));
    expect(JSON.parse(localStorage.getItem("kb.favorites")!)).toEqual(["/r/ext--argoproj.io--v1alpha1--applications?scoped=1"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Application from favorites" }));
    expect(JSON.parse(localStorage.getItem("kb.favorites")!)).toEqual([]);
  });

  it("stars a whole group as a /crds?group= shortcut", async () => {
    renderCrds();
    fireEvent.click(await screen.findByRole("button", { name: "Add argoproj.io to favorites" }));
    expect(JSON.parse(localStorage.getItem("kb.favorites")!)).toEqual(["/crds?group=argoproj.io"]);
  });

  it("opening a group shortcut shows only that group", async () => {
    renderCrds("/crds?group=example.com");
    expect(await screen.findByText("X")).toBeTruthy();
    expect(screen.queryByText("Application")).toBeNull();
  });
});
