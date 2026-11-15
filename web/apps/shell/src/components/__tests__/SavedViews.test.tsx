import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { OpenSavedView, SavedViewsCard, SavedViewsSidebar } from "../SavedViews";
import { useSavedViews, type ViewDraft } from "../../lib/savedViews";
import { useClusterStore } from "../../lib/cluster-store";
import { connectCluster } from "../../lib/clusterConnections";

vi.mock("../../lib/clusterConnections", async (orig) => ({ ...(await orig<typeof import("../../lib/clusterConnections")>()), connectCluster: vi.fn() }));

const draft: ViewDraft = { name: "Shop deployments", cluster: "kind-dev", kind: "deployments", namespaces: ["shop"], filter: "status:crash" };

function Where() {
  const l = useLocation();
  return <div data-testid="at">{l.pathname + l.search}</div>;
}

beforeEach(() => {
  localStorage.clear();
  useSavedViews.setState({ views: [] });
  useClusterStore.setState({ active: "" });
  vi.mocked(connectCluster).mockReset();
});

describe("SavedViewsSidebar (KB-16)", () => {
  it("lists views linking to them, and removes one", () => {
    const v = useSavedViews.getState().add(draft);
    render(
      <MemoryRouter>
        <SavedViewsSidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Shop deployments" })).toHaveAttribute("href", `/view/${v.id}`);
    fireEvent.click(screen.getByRole("button", { name: "Remove view Shop deployments" }));
    expect(useSavedViews.getState().views).toEqual([]);
  });

  it("shows nothing without views", () => {
    const { container } = render(
      <MemoryRouter>
        <SavedViewsSidebar />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("OpenSavedView", () => {
  it("connects the view's cluster, applies it, and opens its table", async () => {
    const v = useSavedViews.getState().add(draft);
    render(
      <MemoryRouter initialEntries={[`/view/${v.id}`]}>
        <Routes>
          <Route path="/view/:id" element={<OpenSavedView />} />
          <Route path="/r/:kind" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("at").textContent).toBe(`/r/deployments?q=status%3Acrash&view=${v.id}`));
    expect(connectCluster).toHaveBeenCalledWith("kind-dev");
    expect(useClusterStore.getState().active).toBe("kind-dev");
  });

  it("says so when the view is gone", () => {
    render(
      <MemoryRouter initialEntries={["/view/nope"]}>
        <Routes>
          <Route path="/view/:id" element={<OpenSavedView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(/no longer exists/)).toBeInTheDocument();
  });
});

describe("SavedViewsCard", () => {
  let saved: Blob[];
  beforeEach(() => {
    saved = [];
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => (saved.push(b), "blob:x")), revokeObjectURL: vi.fn() }));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exports the views as a file and imports one back", async () => {
    useSavedViews.getState().add(draft);
    render(
      <MemoryRouter>
        <SavedViewsCard />
      </MemoryRouter>,
    );
    expect(screen.getByText("Shop deployments")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    const text = await saved[0]!.text();
    expect(JSON.parse(text)).toMatchObject({ kind: "kubebay.savedViews", views: [{ name: "Shop deployments" }] });

    useSavedViews.setState({ views: [] });
    const file = new File([text], "views.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import saved views"), { target: { files: [file] } });
    expect(await screen.findByText(/Imported 1 view/)).toBeInTheDocument();
    expect(useSavedViews.getState().views.map((v) => v.name)).toEqual(["Shop deployments"]);
  });

  it("says why a file can't be imported", async () => {
    render(
      <MemoryRouter>
        <SavedViewsCard />
      </MemoryRouter>,
    );
    const file = new File(["{}"], "x.json", { type: "application/json" });
    fireEvent.change(screen.getByLabelText("Import saved views"), { target: { files: [file] } });
    expect(await screen.findByText(/isn't a file of Kubebay saved views/)).toBeInTheDocument();
  });

  it("deletes a view", () => {
    useSavedViews.getState().add(draft);
    render(
      <MemoryRouter>
        <SavedViewsCard />
      </MemoryRouter>,
    );
    const row = screen.getByText("Shop deployments").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(useSavedViews.getState().views).toEqual([]);
  });
});
