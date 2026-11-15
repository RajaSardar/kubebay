import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useRemoteDisconnects } from "./useRemoteDisconnects";
import { useClusterStore } from "./cluster-store";
import * as conns from "./clusterConnections";

let remote: ((id: string) => void) | null = null;
vi.mock("./clusterChannel", () => ({
  announceDisconnect: vi.fn(),
  onRemoteDisconnect: (h: (id: string) => void) => {
    remote = h;
    return () => {
      remote = null;
    };
  },
}));
vi.mock("./clusterConnections", () => ({ disconnectCluster: vi.fn() }));
vi.mock("./api", async (orig) => {
  const actual = await orig<typeof import("./api")>();
  return { ...actual, historyApi: { ...actual.historyApi, enroll: vi.fn(() => Promise.resolve()) } };
});

const navigateMock = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateMock };
});

function setup() {
  const qc = new QueryClient();
  qc.setQueryData(["kind-dev", "pods"], [1]);
  qc.setQueryData(["stage", "pods"], [2]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useRemoteDisconnects(), { wrapper });
  return { qc, hook };
}

beforeEach(() => {
  navigateMock.mockReset();
  vi.mocked(conns.disconnectCluster).mockReset();
  useClusterStore.setState({ active: "" });
});

describe("useRemoteDisconnects", () => {
  it("drops a cluster another window disconnected and leaves the page it was showing", () => {
    useClusterStore.setState({ active: "kind-dev" });
    const { qc } = setup();
    act(() => remote!("kind-dev"));
    expect(conns.disconnectCluster).toHaveBeenCalledWith("kind-dev");
    expect(useClusterStore.getState().active).toBe("");
    expect(qc.getQueryData(["kind-dev", "pods"])).toBeUndefined();
    expect(qc.getQueryData(["stage", "pods"])).toEqual([2]);
    expect(navigateMock).toHaveBeenCalledWith("/clusters", { replace: true });
  });

  it("stays put when the disconnected cluster isn't the one on screen", () => {
    useClusterStore.setState({ active: "stage" });
    setup();
    act(() => remote!("kind-dev"));
    expect(conns.disconnectCluster).toHaveBeenCalledWith("kind-dev");
    expect(useClusterStore.getState().active).toBe("stage");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("stops listening on unmount", () => {
    const { hook } = setup();
    hook.unmount();
    expect(remote).toBeNull();
  });
});
