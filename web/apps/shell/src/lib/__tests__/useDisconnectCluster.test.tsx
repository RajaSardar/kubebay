import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const disconnectCluster = vi.fn();
const announceDisconnect = vi.fn();
vi.mock("../api", () => ({ api: { disconnectCluster: (id: string) => disconnectCluster(id) } }));
vi.mock("../clusterChannel", () => ({
  announceDisconnect: (id: string) => announceDisconnect(id),
  onRemoteDisconnect: () => () => {},
}));

const { useDisconnectCluster } = await import("../useDisconnectCluster");
const { useClusterStore } = await import("../cluster-store");

function setup() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useDisconnectCluster(), { wrapper });
}

describe("useDisconnectCluster", () => {
  beforeEach(() => {
    disconnectCluster.mockReset();
    announceDisconnect.mockReset();
  });

  it("drops locally, announces, calls the engine and returns no error", async () => {
    disconnectCluster.mockResolvedValue({ ok: true });
    useClusterStore.setState({ active: "a" });
    const { result } = setup();
    let err: string | undefined;
    await act(async () => {
      err = await result.current("a");
    });
    expect(err).toBeUndefined();
    expect(useClusterStore.getState().active).toBe("");
    expect(announceDisconnect).toHaveBeenCalledWith("a");
    expect(disconnectCluster).toHaveBeenCalledWith("a");
  });

  it("returns the engine's error message", async () => {
    disconnectCluster.mockRejectedValue(new Error("boom"));
    const { result } = setup();
    let err: string | undefined;
    await act(async () => {
      err = await result.current("a");
    });
    expect(err).toBe("Disconnect a: boom");
  });
});
