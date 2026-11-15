import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ResourceClaimSummary } from "../ResourceClaimSummary";

const allocated = {
  metadata: { name: "e2e-gpu", namespace: "kubebay-dra" },
  spec: { devices: { requests: [{ name: "gpu", exactly: { deviceClassName: "gpu.example.com" } }] } },
  status: {
    allocation: {
      devices: { results: [{ request: "gpu", driver: "gpu.example.com", pool: "kubebay-dra-worker", device: "gpu-3" }] },
      nodeSelector: { nodeSelectorTerms: [{ matchFields: [{ key: "metadata.name", operator: "In", values: ["kubebay-dra-worker"] }] }] },
    },
    reservedFor: [{ resource: "pods", name: "e2e-gpu-pod", uid: "u1" }],
  },
};

const view = (obj: Record<string, unknown>) =>
  render(
    <MemoryRouter>
      <ResourceClaimSummary obj={obj} />
    </MemoryRouter>,
  );

describe("ResourceClaimSummary", () => {
  it("shows what the claim asks for, what it got, and who holds it", () => {
    view(allocated);
    expect(screen.getByText("allocated,reserved")).toBeTruthy();
    expect(screen.getByText("gpu.example.com", { selector: ".pod-kv *" })).toBeTruthy();
    // Each allocated device: the request it answers, the driver, pool/device.
    expect(screen.getByText("kubebay-dra-worker/gpu-3")).toBeTruthy();
    expect(screen.getByText(/gpu\.example\.com · request gpu/)).toBeTruthy();
    const pod = screen.getByRole("link", { name: "e2e-gpu-pod" });
    expect(pod.getAttribute("href")).toBe("/workloads?pod=kubebay-dra%2Fe2e-gpu-pod");
  });

  it("says plainly when nothing is allocated yet", () => {
    view({ metadata: { name: "c", namespace: "ns" }, spec: allocated.spec, status: {} });
    expect(screen.getByText("pending")).toBeTruthy();
    expect(screen.getByText("Not allocated yet: no device has been picked for this claim.")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
