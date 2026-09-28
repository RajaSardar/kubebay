import { describe, it, expect } from "vitest";
import { describeVolume } from "../podVolumes";

describe("describeVolume", () => {
  it("describes a persistentVolumeClaim with a link to the PVC", () => {
    const d = describeVolume({ name: "data", persistentVolumeClaim: { claimName: "data-pvc" } }, "prod");
    expect(d.label).toBe("PVC");
    expect(d.detail).toContain("data-pvc");
    expect(d.link).toEqual({ kind: "persistentvolumeclaims", ns: "prod", name: "data-pvc" });
  });

  it("flags a read-only PVC mount", () => {
    const d = describeVolume({ name: "data", persistentVolumeClaim: { claimName: "data-pvc", readOnly: true } }, "prod");
    expect(d.detail).toMatch(/ro/i);
  });

  it("describes a configMap volume with a link, noting optional", () => {
    const d = describeVolume({ name: "cfg", configMap: { name: "app-config", optional: true } }, "prod");
    expect(d.label).toBe("ConfigMap");
    expect(d.detail).toContain("app-config");
    expect(d.detail).toMatch(/optional/i);
    expect(d.link).toEqual({ kind: "configmaps", ns: "prod", name: "app-config" });
  });

  it("describes a secret volume with a link, never showing secret contents", () => {
    const d = describeVolume({ name: "tls", secret: { secretName: "tls-cert" } }, "prod");
    expect(d.label).toBe("Secret");
    expect(d.detail).toContain("tls-cert");
    expect(d.link).toEqual({ kind: "secrets", ns: "prod", name: "tls-cert" });
  });

  it("describes a hostPath volume with its path and type, no link", () => {
    const d = describeVolume({ name: "docker", hostPath: { path: "/var/run/docker.sock", type: "Socket" } }, "prod");
    expect(d.label).toBe("hostPath");
    expect(d.detail).toContain("/var/run/docker.sock");
    expect(d.detail).toContain("Socket");
    expect(d.link).toBeUndefined();
  });

  it("describes an emptyDir volume with medium and sizeLimit, no link", () => {
    const d = describeVolume({ name: "scratch", emptyDir: { medium: "Memory", sizeLimit: "64Mi" } }, "prod");
    expect(d.label).toBe("emptyDir");
    expect(d.detail).toContain("Memory");
    expect(d.detail).toContain("64Mi");
    expect(d.link).toBeUndefined();
  });

  it("defaults emptyDir medium to disk-backed when unset", () => {
    const d = describeVolume({ name: "scratch", emptyDir: {} }, "prod");
    expect(d.detail.toLowerCase()).not.toContain("memory");
  });

  it("describes a projected volume by listing its source kinds, no link", () => {
    const d = describeVolume(
      {
        name: "proj",
        projected: { sources: [{ configMap: { name: "a" } }, { secret: { name: "b" } }, { downwardAPI: {} }] },
      },
      "prod",
    );
    expect(d.label).toBe("projected");
    expect(d.detail).toContain("configMap");
    expect(d.detail).toContain("secret");
    expect(d.detail).toContain("downwardAPI");
  });

  it("describes a downwardAPI volume by listing its item field paths", () => {
    const d = describeVolume(
      { name: "meta", downwardAPI: { items: [{ path: "labels", fieldRef: { fieldPath: "metadata.labels" } }] } },
      "prod",
    );
    expect(d.label).toBe("downwardAPI");
    expect(d.detail).toContain("metadata.labels");
  });

  it("falls back to a generic description for an unrecognized volume type", () => {
    const d = describeVolume({ name: "weird", somethingExotic: { foo: "bar" } }, "prod");
    expect(d.label).toBe("somethingExotic");
    expect(d.link).toBeUndefined();
  });
});
