import { describe, expect, it } from "vitest";
import { claimDeviceClasses, claimDevices, claimState, claimUsers, classDriver, podResourceClaims, sliceNodes } from "../dra";

// KB-12: Dynamic Resource Allocation (resource.k8s.io/v1, GA in 1.34).

const allocated = {
  metadata: { name: "gpu-claim", namespace: "ml" },
  spec: { devices: { requests: [{ name: "gpu", exactly: { deviceClassName: "gpu.nvidia.com", count: 2 } }] } },
  status: {
    allocation: {
      devices: {
        results: [
          { request: "gpu", driver: "gpu.nvidia.com", pool: "node-1", device: "gpu-0" },
          { request: "gpu", driver: "gpu.nvidia.com", pool: "node-1", device: "gpu-1" },
        ],
      },
    },
    reservedFor: [{ resource: "pods", name: "trainer-0", uid: "u1" }],
  },
};

describe("ResourceClaim columns", () => {
  it("states it the way kubectl does", () => {
    expect(claimState(allocated)).toEqual({ v: "allocated,reserved", dot: "ok" });
    expect(claimState({ ...allocated, status: { allocation: allocated.status.allocation } })).toEqual({ v: "allocated", dot: "ok" });
    expect(claimState({ spec: {} })).toEqual({ v: "pending", dot: "warn" });
    expect(claimState({ metadata: { deletionTimestamp: "2026-10-13T00:00:00Z" }, status: allocated.status })).toEqual({ v: "deleted", dot: "err" });
  });

  it("names the device classes it asks for, in v1 and in the beta shape", () => {
    expect(claimDeviceClasses(allocated.spec)).toBe("gpu.nvidia.com");
    const beta = { devices: { requests: [{ name: "a", deviceClassName: "fpga.example.com" }] } };
    expect(claimDeviceClasses(beta)).toBe("fpga.example.com");
    const firstAvailable = {
      devices: {
        requests: [{ name: "a", firstAvailable: [{ name: "big", deviceClassName: "gpu-80g" }, { name: "small", deviceClassName: "gpu-40g" }] }],
      },
    };
    expect(claimDeviceClasses(firstAvailable)).toBe("gpu-80g | gpu-40g");
    expect(claimDeviceClasses({})).toBe("–");
  });

  it("lists the devices it was given and who uses them", () => {
    expect(claimDevices(allocated)).toBe("node-1/gpu-0, node-1/gpu-1");
    expect(claimDevices({ status: {} })).toBe("–");
    expect(claimUsers(allocated)).toBe("trainer-0");
    expect(claimUsers({})).toBe("–");
  });
});

describe("DeviceClass and ResourceSlice columns", () => {
  it("reads the driver a class selects from its CEL selector", () => {
    expect(classDriver({ spec: { selectors: [{ cel: { expression: 'device.driver == "gpu.nvidia.com"' } }] } })).toBe("gpu.nvidia.com");
    expect(classDriver({ spec: { selectors: [{ cel: { expression: "device.driver == 'tpu.google.com' && device.attributes['x'].y" } }] } })).toBe("tpu.google.com");
    expect(classDriver({ spec: { selectors: [{ cel: { expression: "device.capacity['memory'] > 1" } }] } })).toBe("–");
  });

  it("says which nodes a slice's devices are on", () => {
    expect(sliceNodes({ spec: { nodeName: "node-1" } })).toBe("node-1");
    expect(sliceNodes({ spec: { allNodes: true } })).toBe("all nodes");
    expect(sliceNodes({ spec: { nodeSelector: { nodeSelectorTerms: [] } } })).toBe("selected nodes");
    expect(sliceNodes({ spec: { perDeviceNodeSelection: true } })).toBe("per device");
    expect(sliceNodes({ spec: {} })).toBe("–");
  });
});

describe("podResourceClaims", () => {
  it("resolves each claim the pod names to the claim object", () => {
    const pod = {
      metadata: { name: "trainer-0", namespace: "ml" },
      spec: {
        resourceClaims: [
          { name: "gpu", resourceClaimTemplateName: "gpu-template" },
          { name: "shared", resourceClaimName: "shared-fpga" },
          { name: "pending", resourceClaimTemplateName: "gpu-template" },
        ],
      },
      status: { resourceClaimStatuses: [{ name: "gpu", resourceClaimName: "trainer-0-gpu-x7k2p" }] },
    };
    expect(podResourceClaims(pod)).toEqual([
      { name: "gpu", claim: "trainer-0-gpu-x7k2p", template: "gpu-template" },
      { name: "shared", claim: "shared-fpga" },
      { name: "pending", template: "gpu-template" },
    ]);
    expect(podResourceClaims({ spec: {} })).toEqual([]);
  });
});
