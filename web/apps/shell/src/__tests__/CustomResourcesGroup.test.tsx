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

function entries(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const kind = `Widget${String(n - i).padStart(3, "0")}`;
    return {
      gvr: `example.io/v1/${kind.toLowerCase()}s`,
      group: "example.io",
      version: "v1",
      resource: `${kind.toLowerCase()}s`,
      kind,
      namespaced: true,
    };
  });
}

function renderGroup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["clusters"], [{ id: "kind-dev", status: "connected" }]);
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

  it("never hides custom resources without saying so", async () => {
    apis.mockResolvedValue(entries(213));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));

    const more = await screen.findByRole("button", { name: /Show all 213/ });
    expect(screen.getByText("213")).toBeInTheDocument();
    expect(screen.getByText("Widget001")).toBeInTheDocument();
    expect(screen.queryByText("Widget213")).not.toBeInTheDocument();

    fireEvent.click(more);
    expect(await screen.findByText("Widget213")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("offers no truncation affordance when everything fits", async () => {
    apis.mockResolvedValue(entries(12));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));

    await waitFor(() => expect(screen.getByText("Widget001")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Show all/ })).not.toBeInTheDocument();
  });

  it("orders kinds alphabetically rather than by discovery order", async () => {
    apis.mockResolvedValue(entries(5));
    renderGroup();

    fireEvent.click(await screen.findByText("Custom Resources"));

    await waitFor(() => expect(screen.getByText("Widget001")).toBeInTheDocument());
    const links = screen.getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Widget001", "Widget002", "Widget003", "Widget004", "Widget005"]);
  });
});
