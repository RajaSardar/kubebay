import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WarmClustersCard } from "../WarmClustersCard";
import { warmPolicyApi, type WarmPolicy } from "../../lib/api";

let policy: WarmPolicy;

vi.mock("../../lib/api", () => ({
  warmPolicyApi: {
    get: vi.fn(async () => policy),
    save: vi.fn(async (b: { clusters: number; idleMinutes: number }) => {
      policy = { ...policy, ...b };
      return policy;
    }),
  },
}));

const base = (): WarmPolicy => ({ available: true, clusters: 5, idleMinutes: 30, defaultClusters: 5, defaultIdleMinutes: 30 });

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WarmClustersCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  policy = base();
  vi.mocked(warmPolicyApi.save).mockClear();
});

describe("WarmClustersCard", () => {
  it("shows the cap and idle minutes the engine is using", async () => {
    policy = { ...base(), clusters: 3, idleMinutes: 10 };
    renderCard();
    expect(await screen.findByLabelText("Warm clusters")).toHaveValue(3);
    expect(screen.getByLabelText("Idle minutes")).toHaveValue(10);
  });

  it("saves both numbers", async () => {
    renderCard();
    fireEvent.change(await screen.findByLabelText("Warm clusters"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Idle minutes"), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(warmPolicyApi.save).toHaveBeenCalledWith({ clusters: 8, idleMinutes: 45 }));
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it("refuses a number outside the range without calling the engine", async () => {
    renderCard();
    fireEvent.change(await screen.findByLabelText("Warm clusters"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/0 to 50/)).toBeInTheDocument();
    expect(warmPolicyApi.save).not.toHaveBeenCalled();
  });

  it("resets to the defaults", async () => {
    policy = { ...base(), clusters: 2, idleMinutes: 5 };
    renderCard();
    await screen.findByLabelText("Warm clusters");
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(screen.getByLabelText("Warm clusters")).toHaveValue(5);
    expect(screen.getByLabelText("Idle minutes")).toHaveValue(30);
  });

  it("is disabled and says why under OIDC or in-cluster", async () => {
    policy = { ...base(), available: false, reason: "Not available when OIDC is configured." };
    renderCard();
    expect(await screen.findByText(/Not available when OIDC is configured/)).toBeInTheDocument();
    expect(screen.getByLabelText("Warm clusters")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
