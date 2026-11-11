import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

// Backlog #19: a pod's IPs, like Lens and Freelens show them. Every pod IP
// (both families on a dual-stack pod) and the node's IP it runs on, each
// labelled and copyable.

vi.mock("../../lib/useOwnerChain", () => ({ useOwnerChain: () => [] }));
const { PodSummary } = await import("../PodSummary");

function renderPod(status: Record<string, unknown>) {
  const obj = { metadata: { name: "web-1", namespace: "shop", uid: "u1" }, spec: { nodeName: "node-a", containers: [] }, status: { phase: "Running", ...status } };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PodSummary obj={obj} cluster="c1" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const row = (label: string) => screen.getByText(label, { selector: ".pod-kv > span:first-child" }).parentElement!;

describe("a pod's IPs", () => {
  it("lists every pod IP and the host IP, each copyable", () => {
    renderPod({
      podIP: "10.244.0.5",
      podIPs: [{ ip: "10.244.0.5" }, { ip: "fd00:10:244::5" }],
      hostIP: "172.18.0.2",
      hostIPs: [{ ip: "172.18.0.2" }],
    });
    expect(row("Pod IPs")).toHaveTextContent("10.244.0.5");
    expect(row("Pod IPs")).toHaveTextContent("fd00:10:244::5");
    expect(row("Host IP")).toHaveTextContent("172.18.0.2");
    expect(screen.getByRole("button", { name: "Copy pod IP 10.244.0.5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy pod IP fd00:10:244::5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy host IP 172.18.0.2" })).toBeInTheDocument();
  });

  it("falls back to the single fields an older API server sends", () => {
    renderPod({ podIP: "10.1.2.3", hostIP: "192.168.1.9" });
    expect(row("Pod IP")).toHaveTextContent("10.1.2.3");
    expect(row("Host IP")).toHaveTextContent("192.168.1.9");
  });

  it("says when a pod has no IP yet, rather than showing nothing", () => {
    renderPod({ phase: "Pending" });
    expect(row("Pod IP")).toHaveTextContent("not assigned yet");
  });
});
