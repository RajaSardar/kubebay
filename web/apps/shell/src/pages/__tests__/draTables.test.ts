/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extraColumns } from "../ResourceTable";
import { lookupDef } from "../../lib/resources";

// KB-12: the DRA kinds (resource.k8s.io/v1) get tables of their own.

const sp = new URLSearchParams();

describe("DRA resource definitions", () => {
  it("defines the four kinds at resource.k8s.io/v1, with the right scope", () => {
    expect(lookupDef("resourceclaims", sp)).toMatchObject({ kind: "ResourceClaim", gvr: "resource.k8s.io/v1/resourceclaims", scoped: false, mode: "full" });
    expect(lookupDef("resourceclaimtemplates", sp)).toMatchObject({ kind: "ResourceClaimTemplate", gvr: "resource.k8s.io/v1/resourceclaimtemplates", scoped: false, mode: "full" });
    expect(lookupDef("deviceclasses", sp)).toMatchObject({ kind: "DeviceClass", gvr: "resource.k8s.io/v1/deviceclasses", scoped: true, mode: "full" });
    expect(lookupDef("resourceslices", sp)).toMatchObject({ kind: "ResourceSlice", gvr: "resource.k8s.io/v1/resourceslices", scoped: true, mode: "full" });
  });
});

describe("DRA columns", () => {
  it("shows a claim's state, classes, devices and users", () => {
    const cols = extraColumns("resourceclaims");
    const claim = {
      spec: { devices: { requests: [{ name: "gpu", exactly: { deviceClassName: "gpu.nvidia.com" } }] } },
      status: { allocation: { devices: { results: [{ pool: "node-1", device: "gpu-0" }] } }, reservedFor: [{ name: "trainer-0" }] },
    };
    expect(Object.keys(cols)).toEqual(["State", "Device class", "Devices", "Reserved for"]);
    expect(cols.State!(claim)).toEqual({ v: "allocated,reserved", dot: "ok" });
    expect(cols["Device class"]!(claim).v).toBe("gpu.nvidia.com");
    expect(cols.Devices!(claim).v).toBe("node-1/gpu-0");
    expect(cols["Reserved for"]!(claim).v).toBe("trainer-0");
  });

  it("shows a claim template's device classes", () => {
    const cols = extraColumns("resourceclaimtemplates");
    const tpl = { spec: { spec: { devices: { requests: [{ name: "a", exactly: { deviceClassName: "gpu-80g" } }, { name: "b", exactly: { deviceClassName: "nic" } }] } } } };
    expect(cols["Device class"]!(tpl).v).toBe("gpu-80g, nic");
    expect(cols.Requests!(tpl).v).toBe("2");
  });

  it("shows a class's driver and selector count", () => {
    const cols = extraColumns("deviceclasses");
    const cls = { spec: { selectors: [{ cel: { expression: 'device.driver == "gpu.nvidia.com"' } }, { cel: { expression: "true" } }] } };
    expect(cols.Driver!(cls).v).toBe("gpu.nvidia.com");
    expect(cols.Selectors!(cls).v).toBe("2");
  });

  it("shows a slice's driver, pool, nodes and device count", () => {
    const cols = extraColumns("resourceslices");
    const slice = { spec: { driver: "gpu.nvidia.com", pool: { name: "node-1", generation: 3 }, nodeName: "node-1", devices: [{ name: "gpu-0" }, { name: "gpu-1" }] } };
    expect(cols.Driver!(slice).v).toBe("gpu.nvidia.com");
    expect(cols.Pool!(slice).v).toBe("node-1");
    expect(cols.Nodes!(slice)).toEqual({ v: "node-1", to: { kind: "nodes", ns: "", name: "node-1" } });
    expect(cols.Devices!(slice).v).toBe("2");
    expect(cols.Nodes!({ spec: { allNodes: true } })).toEqual({ v: "all nodes" });
  });
});

describe("the sidebar", () => {
  const app = readFileSync(resolve(__dirname, "../../App.tsx"), "utf8");

  it("lists the DRA tables", () => {
    for (const slug of ["resourceclaims", "resourceclaimtemplates", "deviceclasses", "resourceslices"]) {
      expect(app).toContain(`to: "/r/${slug}"`);
    }
  });

  it("links only to resource tables that exist", () => {
    const slugs = [...app.matchAll(/to: "\/r\/([^"?]+)"/g)].map((m) => m[1]!);
    expect(slugs.length).toBeGreaterThan(30);
    expect(slugs.filter((s) => !lookupDef(s, sp))).toEqual([]);
  });
});
