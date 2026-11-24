import { describe, it, expect } from "vitest";
import { versionSkewFindings } from "../upgradeSkew";

const node = (name: string, kubelet: string, proxy?: string) => ({
  metadata: { name },
  status: { nodeInfo: { kubeletVersion: kubelet, ...(proxy !== undefined ? { kubeProxyVersion: proxy } : {}) } },
});

describe("versionSkewFindings", () => {
  it("is quiet when everything is within policy", () => {
    expect(versionSkewFindings("v1.30.2", [node("a", "v1.30.2", "v1.30.2"), node("b", "v1.30.0", "v1.28.0")])).toEqual([]);
  });
  it("flags a kubelet more than 3 minors older than the API server", () => {
    const f = versionSkewFindings("v1.31.0", [node("old", "v1.27.4")]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: "kubelet-too-old", node: "old", component: "kubelet" });
  });
  it("flags a kubelet newer than the API server", () => {
    expect(versionSkewFindings("v1.29.0", [node("new", "v1.30.1")]).map((f) => f.kind)).toEqual(["kubelet-newer"]);
  });
  it("flags kube-proxy outside policy, and skips an empty kube-proxy version", () => {
    expect(versionSkewFindings("v1.31.0", [node("a", "v1.31.0", "v1.27.0")]).map((f) => f.kind)).toEqual(["kube-proxy-too-old"]);
    expect(versionSkewFindings("v1.31.0", [node("a", "v1.31.0", "v1.32.0")]).map((f) => f.kind)).toEqual(["kube-proxy-newer"]);
    expect(versionSkewFindings("v1.31.0", [node("a", "v1.31.0", "")])).toEqual([]);
  });
  it("checks against the target version, so nodes that would fall out of policy show up", () => {
    const f = versionSkewFindings("v1.29.0", [node("a", "v1.29.0")], "v1.33.0");
    expect(f[0]).toMatchObject({ kind: "kubelet-too-old", afterTarget: true });
    expect(versionSkewFindings("v1.29.0", [node("a", "v1.29.0")], "v1.30.0")).toEqual([]);
  });
  it("notes nodes on different minors", () => {
    const f = versionSkewFindings("v1.30.0", [node("a", "v1.30.0"), node("b", "v1.29.3"), node("c", "v1.29.1")]);
    expect(f.map((x) => x.kind)).toEqual(["mixed-minors"]);
    expect(f[0]!.detail).toMatch(/1\.29/);
  });
  it("ignores unparseable versions and nodes with no status", () => {
    expect(versionSkewFindings("garbage", [node("a", "v1.30.0")])).toEqual([]);
    expect(versionSkewFindings("v1.30.0", [{ metadata: { name: "x" } }, node("b", "")])).toEqual([]);
  });
});
