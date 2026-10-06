import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { NamespaceSummary } from "../NamespaceSummary";

const navigateMock = vi.fn();

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

// Each call to useResourceStream returns rows for one GVR
const streamData: Record<string, unknown[]> = {
  "v1/pods": [
    { status: { phase: "Running" } },
    { status: { phase: "Running" } },
    { status: { phase: "Pending" } },
  ],
  "apps/v1/deployments": [{ metadata: {} }, { metadata: {} }],
  "apps/v1/statefulsets": [{ metadata: {} }],
  "v1/services": [{ metadata: {} }, { metadata: {} }, { metadata: {} }],
  "v1/configmaps": [{ metadata: {} }, { metadata: {} }],
  "v1/secrets": [{ metadata: {} }],
};

vi.mock("../../lib/useResourceStream", () => ({
  useResourceStream: (_cluster: string, gvr: string) => ({
    rows: streamData[gvr] ?? [],
    synced: true,
  }),
}));

function render$(ns = "platform") {
  return render(
    <MemoryRouter>
      <NamespaceSummary cluster="kind-test" namespace={ns} />
    </MemoryRouter>,
  );
}

describe("NamespaceSummary (backlog #2)", () => {
  it("shows a row for each resource type", () => {
    render$();
    expect(screen.getByText(/pods/i)).toBeInTheDocument();
    expect(screen.getByText(/deployments/i)).toBeInTheDocument();
    expect(screen.getByText(/statefulsets/i)).toBeInTheDocument();
    expect(screen.getByText(/services/i)).toBeInTheDocument();
    expect(screen.getByText(/configmaps/i)).toBeInTheDocument();
    expect(screen.getByText(/secrets/i)).toBeInTheDocument();
  });

  it("shows counts for each resource type", () => {
    render$();
    // 3 pods, 2 deployments, 1 statefulset, 3 services, 2 configmaps, 1 secret
    expect(screen.getByTestId("count-pods").textContent).toBe("3");
    expect(screen.getByTestId("count-deployments").textContent).toBe("2");
    expect(screen.getByTestId("count-statefulsets").textContent).toBe("1");
    expect(screen.getByTestId("count-services").textContent).toBe("3");
    expect(screen.getByTestId("count-configmaps").textContent).toBe("2");
    expect(screen.getByTestId("count-secrets").textContent).toBe("1");
  });

  it("shows running/total for pods", () => {
    render$();
    expect(screen.getByTestId("count-pods").textContent).toBe("3");
    expect(screen.getByText(/2 running/i)).toBeInTheDocument();
  });

  it("clicking a row navigates to the filtered resource table", () => {
    render$();
    fireEvent.click(screen.getByTestId("row-deployments"));
    expect(navigateMock).toHaveBeenCalledWith(expect.stringContaining("deployments"));
  });
});
