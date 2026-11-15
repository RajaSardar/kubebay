import { describe, it, expect } from "vitest";
import { CONTROLS, controlsFor, rbacFindingControls, type ControlRef } from "../controlIds";

const ids = (refs: ControlRef[]) => refs.map((r) => `${r.framework} ${r.id}`);

describe("controlsFor", () => {
  it("maps each detector to its CIS Kubernetes Benchmark section", () => {
    expect(ids(controlsFor("secret-env"))).toEqual(["CIS 5.4.1"]);
    expect(ids(controlsFor("netpol-gap"))).toEqual(["CIS 5.3.2"]);
    expect(ids(controlsFor("default-sa-automount"))).toEqual(["CIS 5.1.5", "CIS 5.1.6", "ATT&CK T1528"]);
    expect(ids(controlsFor("unverified-images"))).toEqual(["CIS 5.5.1", "ATT&CK T1525"]);
  });

  it("gives every control a human-readable name", () => {
    for (const refs of Object.values(CONTROLS)) {
      for (const r of refs) expect(r.name.length).toBeGreaterThan(10);
    }
  });
});

describe("rbacFindingControls", () => {
  const f = (title: string) => ({ severity: "high" as const, title, subject: "s", roleRef: "ClusterRole:x", why: "" });

  it("tags wildcard rules with CIS 5.1.3", () => {
    expect(ids(rbacFindingControls(f("Wildcard verb (*)")))).toEqual(["CIS 5.1.3"]);
    expect(ids(rbacFindingControls(f("Wildcard resource (*)")))).toEqual(["CIS 5.1.3"]);
    expect(ids(rbacFindingControls(f("Wildcard apiGroup (*)")))).toEqual(["CIS 5.1.3"]);
  });

  it("tags cluster-admin bindings with 5.1.1, and admin-equivalent wildcards with 5.1.1 and 5.1.3", () => {
    expect(ids(rbacFindingControls(f("Bound to the built-in cluster-admin role")))).toEqual(["CIS 5.1.1"]);
    expect(ids(rbacFindingControls(f("Full cluster-admin-equivalent access")))).toEqual(["CIS 5.1.1", "CIS 5.1.3"]);
  });

  it("tags escalation verbs, secret reads and pod exec", () => {
    expect(ids(rbacFindingControls(f("Privilege-escalation verb(s) present")))).toEqual(["CIS 5.1.8"]);
    expect(ids(rbacFindingControls(f("Cluster-wide Secret read access")))).toEqual(["CIS 5.1.2", "ATT&CK T1552.007"]);
    expect(ids(rbacFindingControls(f("Cluster-wide pod exec access")))).toEqual(["ATT&CK T1609"]);
  });

  it("leaves a finding with no clear control untagged rather than guessing", () => {
    expect(rbacFindingControls(f("ServiceAccount subject does not exist"))).toEqual([]);
    expect(rbacFindingControls(f("Something new the engine added"))).toEqual([]);
  });
});
