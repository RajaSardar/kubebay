import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const apis = vi.fn();

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, discoveryApi: { apis: (c: string) => apis(c) } };
});

const { CustomResourcesGroup } = await import("../App");
const { useClusterStore } = await import("../lib/cluster-store");

function entries(n: number, group = "example.io", prefix = "Widget") {
  return Array.from({ length: n }, (_, i) => {
    const kind = `${prefix}${String(n - i).padStart(3, "0")}`;
    return {
      gvr: `${group}/v1/${kind.toLowerCase()}s`,
      group,
      version: "v1",
      resource: `${kind.toLowerCase()}s`,
      kind,
      namespaced: true,
    };
  });
}

function renderGroup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["clusters"], [{ id: "kind-dev", status: "reachable" }]);
  useClusterStore.setState({ active: "kind-dev" });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CustomResourcesGroup />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CustomResourcesGroup", () => {
  beforeEach(() => apis.mockReset());

  it("nests kinds under a folder for their API group", async () => {
    apis.mockResolvedValue(entries(3, "argoproj.io"));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));

    // The kind is not visible until its group folder is opened.
    const groupFolder = await screen.findByText(/argoproj/);
    expect(screen.queryByText("Widget001")).not.toBeInTheDocument();

    fireEvent.click(groupFolder);
    expect(await screen.findByText("Widget001")).toBeInTheDocument();
    expect(screen.getByText("Widget003")).toBeInTheDocument();
  });

  it("keeps unrelated API groups in separate, independently-expandable folders", async () => {
    apis.mockResolvedValue([
      ...entries(2, "argoproj.io", "Application"),
      ...entries(2, "cert-manager.io", "Certificate"),
    ]);
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));
    fireEvent.click(await screen.findByText(/argoproj/));

    // Opening the argoproj.io folder must not reveal cert-manager.io's kinds.
    expect(await screen.findByText("Application001")).toBeInTheDocument();
    expect(screen.queryByText("Certificate001")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText(/cert-manager/));
    expect(await screen.findByText("Certificate001")).toBeInTheDocument();
  });

  it("never hides custom resources without saying so", async () => {
    apis.mockResolvedValue(entries(213, "example.io"));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));
    fireEvent.click(await screen.findByText(/example/));

    const more = await screen.findByRole("button", { name: /Show all 213/ });
    expect(screen.getByText("Widget001")).toBeInTheDocument();
    expect(screen.queryByText("Widget213")).not.toBeInTheDocument();

    fireEvent.click(more);
    expect(await screen.findByText("Widget213")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("offers no truncation affordance when everything fits", async () => {
    apis.mockResolvedValue(entries(12, "example.io"));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));
    fireEvent.click(await screen.findByText(/example/));

    await waitFor(() => expect(screen.getByText("Widget001")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("orders kinds alphabetically within a group rather than by discovery order", async () => {
    apis.mockResolvedValue(entries(5, "example.io"));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));
    fireEvent.click(await screen.findByText(/example/));

    await waitFor(() => expect(screen.getByText("Widget001")).toBeInTheDocument());
    const links = screen.getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Widget001", "Widget002", "Widget003", "Widget004", "Widget005"]);
  });

  it("orders group folders alphabetically by group name", async () => {
    apis.mockResolvedValue([...entries(1, "zeta.io"), ...entries(1, "argoproj.io")]);
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));
    const folderNames = screen.getAllByText(/\.io/).map((el) => el.textContent?.replace("\u200b", ""));
    expect(folderNames).toEqual(["argoproj.io", "zeta.io"]);
  });

  // It used to list the first reachable cluster's CRDs, whichever cluster was open.
  it("lists the CRDs of the cluster you opened, not the first reachable one", async () => {
    apis.mockResolvedValue(entries(1));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(["clusters"], [{ id: "a-reachable", status: "reachable" }, { id: "opened", status: "reachable" }]);
    useClusterStore.setState({ active: "opened" });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <CustomResourcesGroup />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(apis).toHaveBeenCalledWith("opened"));
    expect(apis).not.toHaveBeenCalledWith("a-reachable");
  });
});

