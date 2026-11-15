import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NamespacesRanked } from "../NamespacesRanked";
import type { NamespaceRank } from "../../lib/namespaceRanking";

const rows: NamespaceRank[] = [
  { namespace: "shop", pods: 12, broken: 3, warnings: 7, cpuRequested: 1500, memRequested: 2 * 1024 ** 3, cpuShare: 60 },
  { namespace: "pay", pods: 4, broken: 0, warnings: 2, cpuRequested: 1000, memRequested: 1024 ** 3, cpuShare: 40 },
];

describe("NamespacesRanked", () => {
  it("lists each namespace with its problems and a link to its pods", () => {
    render(<MemoryRouter><NamespacesRanked rows={rows} by="problems" onBy={vi.fn()} /></MemoryRouter>);
    const section = screen.getByRole("region", { name: /Namespaces/ });
    expect(within(section).getByText("3 broken · 7 warnings · 12 pods")).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "shop" })).toHaveAttribute("href", "/workloads?q=ns%3Ashop");
  });

  it("shows requests and shares when ranked by requests, and switches with the control", () => {
    const onBy = vi.fn();
    render(<MemoryRouter><NamespacesRanked rows={rows} by="requests" onBy={onBy} /></MemoryRouter>);
    expect(screen.getByText("1.50 core · 2.0Gi requested · 60% of CPU requested")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Problems" }));
    expect(onBy).toHaveBeenCalledWith("problems");
  });

  it("is not drawn with fewer than two namespaces", () => {
    const { container } = render(<MemoryRouter><NamespacesRanked rows={rows.slice(0, 1)} by="problems" onBy={vi.fn()} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
