import { describe, expect, it } from "vitest";
import { splitPodName } from "../podName";

// Backlog 61: the generated end of a pod's name, so similar names can be told apart.
describe("splitPodName", () => {
  it("splits a Deployment pod at its ReplicaSet hash and random suffix", () => {
    expect(splitPodName("web-7d9f8c6b5d-x2k4q")).toEqual({ base: "web", suffix: "-7d9f8c6b5d-x2k4q" });
    expect(splitPodName("my-api-server-68c4d5f7b9-4hkzp")).toEqual({ base: "my-api-server", suffix: "-68c4d5f7b9-4hkzp" });
  });

  it("splits a DaemonSet or Job pod at its five-character suffix", () => {
    expect(splitPodName("node-exporter-9fz7k")).toEqual({ base: "node-exporter", suffix: "-9fz7k" });
    expect(splitPodName("backup-28100000-x2k4q")).toEqual({ base: "backup-28100000", suffix: "-x2k4q" });
  });

  it("splits a StatefulSet pod at its ordinal", () => {
    expect(splitPodName("db-0")).toEqual({ base: "db", suffix: "-0" });
    expect(splitPodName("kafka-broker-12")).toEqual({ base: "kafka-broker", suffix: "-12" });
  });

  it("leaves a name with no generated suffix whole", () => {
    expect(splitPodName("etcd")).toEqual({ base: "etcd", suffix: "" });
    expect(splitPodName("kube-apiserver-node-1")).toEqual({ base: "kube-apiserver-node", suffix: "-1" });
    expect(splitPodName("coredns")).toEqual({ base: "coredns", suffix: "" });
  });
});
