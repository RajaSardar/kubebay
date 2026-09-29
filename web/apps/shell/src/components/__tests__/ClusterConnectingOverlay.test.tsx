import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ClusterConnectingOverlay } from "../ClusterConnectingOverlay";

const base = {
  clusterId: "prod-eks",
  clusterStatus: "unreachable",
  wsConnected: false,
  wsRetry: 0,
  wsNextRetryMs: 0,
  isReconnect: false,
  avatar: { bg: "#ff9f0a", label: "AWS" },
};

describe("ClusterConnectingOverlay", () => {
  it("shows the loader while switching to a cluster", () => {
    render(<ClusterConnectingOverlay {...base} />);
    const s = screen.getByRole("status", { name: "Connecting to prod-eks…" });
    expect(s).toHaveClass("kb-spinner");
    expect(screen.getByText("Checking cluster credentials…")).toBeInTheDocument();
  });

  it("keeps the loader while the API is up and the live stream opens", () => {
    render(<ClusterConnectingOverlay {...base} clusterStatus="connected" />);
    expect(screen.getByRole("status", { name: "Connecting to prod-eks…" })).toBeInTheDocument();
    expect(screen.getByText("API reachable · opening live stream…")).toBeInTheDocument();
  });

  it("drops the loader once connected", () => {
    render(<ClusterConnectingOverlay {...base} clusterStatus="connected" wsConnected clusterVersion="v1.31.0" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Connected · v1.31.0")).toBeInTheDocument();
  });

  it("drops the loader on an error, which is not a wait", () => {
    render(<ClusterConnectingOverlay {...base} clusterError="dial tcp: connection refused" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("dial tcp: connection refused")).toBeInTheDocument();
  });

  it("uses the same loader while a dropped stream reconnects", () => {
    render(<ClusterConnectingOverlay {...base} clusterStatus="connected" isReconnect wsRetry={2} wsNextRetryMs={4000} />);
    expect(screen.getByRole("status", { name: "Reconnecting to prod-eks…" })).toHaveClass("kb-spinner");
  });
});
