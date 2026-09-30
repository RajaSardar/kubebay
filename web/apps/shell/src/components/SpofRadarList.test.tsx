import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SpofRadarList } from "./SpofRadarList";
import type { SpofFinding } from "../lib/spof";

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function finding(overrides: Partial<SpofFinding> = {}): SpofFinding {
  return { kind: "no-pdb", ns: "prod", name: "web", workloadKind: "Deployment", detail: "detail text", ...overrides };
}

function renderList(findings: SpofFinding[]) {
  return render(
    <MemoryRouter>
      <SpofRadarList findings={findings} />
    </MemoryRouter>,
  );
}

describe("SpofRadarList", () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it("shows an empty state when there are no findings", () => {
    renderList([]);
    expect(screen.getByText(/no single points of failure/i)).toBeTruthy();
  });

  it("lists a finding with its namespace and detail", () => {
    renderList([finding()]);
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.getByText("prod")).toBeTruthy();
    expect(screen.getByText("detail text")).toBeTruthy();
  });

  it("filters by kind", () => {
    renderList([finding({ kind: "no-pdb", name: "web" }), finding({ kind: "single-backend", name: "api", workloadKind: "Service", detail: "svc detail" })]);
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.getByText("api")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /no pdb/i }));
    expect(screen.getByText("web")).toBeTruthy();
    expect(screen.queryByText("api")).toBeNull();
  });

  it("navigates to the resource on click, using the correct slug for a Deployment", () => {
    renderList([finding({ workloadKind: "Deployment", ns: "prod", name: "web" })]);
    fireEvent.click(screen.getByText("web"));
    expect(navigateMock).toHaveBeenCalledWith("/detail/deployments/prod/web");
  });
});
