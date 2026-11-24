import { describe, expect, it } from "vitest";
import { envFromSources, podConfigRefs } from "../podRefs";

// Backlog 62: which Secrets and ConfigMaps a pod refers to. References only, never values.
const pod = {
  metadata: { namespace: "shop" },
  spec: {
    imagePullSecrets: [{ name: "regcred" }],
    initContainers: [{ name: "init", env: [{ name: "TOKEN", valueFrom: { secretKeyRef: { name: "db", key: "token" } } }] }],
    containers: [
      {
        name: "app",
        env: [
          { name: "PLAIN", value: "x" },
          { name: "PASS", valueFrom: { secretKeyRef: { name: "db", key: "password" } } },
          { name: "MODE", valueFrom: { configMapKeyRef: { name: "cfg", key: "mode" } } },
          { name: "POD", valueFrom: { fieldRef: { fieldPath: "metadata.name" } } },
        ],
        envFrom: [{ secretRef: { name: "creds", optional: true } }, { configMapRef: { name: "cfg" }, prefix: "CFG_" }],
      },
    ],
    volumes: [
      { name: "tls", secret: { secretName: "tls-cert" } },
      { name: "conf", configMap: { name: "cfg" } },
      { name: "proj", projected: { sources: [{ secret: { name: "creds" } }, { configMap: { name: "other" } }, { serviceAccountToken: { path: "t" } }] } },
      { name: "data", emptyDir: {} },
    ],
  },
};

describe("envFromSources", () => {
  it("lists the Secret and ConfigMap sources with prefix and optional", () => {
    expect(envFromSources(pod.spec.containers[0]!)).toEqual([
      { kind: "Secret", name: "creds", prefix: "", optional: true },
      { kind: "ConfigMap", name: "cfg", prefix: "CFG_", optional: false },
    ]);
  });
  it("is empty without envFrom", () => {
    expect(envFromSources({ name: "x" })).toEqual([]);
  });
});

describe("podConfigRefs", () => {
  const refs = podConfigRefs(pod);

  it("collects every Secret once, with where it is used", () => {
    expect(refs.secrets.map((s) => s.name)).toEqual(["creds", "db", "regcred", "tls-cert"]);
    expect(refs.secrets.find((s) => s.name === "db")?.uses).toEqual(["env PASS (app)", "env TOKEN (init)"]);
    expect(refs.secrets.find((s) => s.name === "creds")?.uses).toEqual(["envFrom (app)", "volume proj"]);
    expect(refs.secrets.find((s) => s.name === "regcred")?.uses).toEqual(["imagePullSecrets"]);
    expect(refs.secrets.find((s) => s.name === "tls-cert")?.uses).toEqual(["volume tls"]);
  });

  it("collects every ConfigMap once", () => {
    expect(refs.configMaps.map((c) => c.name)).toEqual(["cfg", "other"]);
    expect(refs.configMaps.find((c) => c.name === "cfg")?.uses).toEqual(["env MODE (app)", "envFrom (app)", "volume conf"]);
  });

  it("carries no values", () => {
    expect(JSON.stringify(refs)).not.toMatch(/"value"/);
  });

  it("is empty for a pod without references", () => {
    expect(podConfigRefs({ spec: { containers: [{ name: "a" }] } })).toEqual({ secrets: [], configMaps: [] });
  });
});
