import { describe, it, expect } from "vitest";
import { rancherCluster, rancherProject, groupByProject } from "../rancher";

describe("rancherCluster (KB-08)", () => {
  it("recognises a context that goes through Rancher's proxy", () => {
    expect(rancherCluster("https://rancher.acme.io/k8s/clusters/c-m-abc12")).toEqual({
      id: "c-m-abc12",
      dashboard: "https://rancher.acme.io/dashboard/c/c-m-abc12/explorer",
    });
    expect(rancherCluster("https://rancher.acme.io:8443/k8s/clusters/local/")?.dashboard).toBe("https://rancher.acme.io:8443/dashboard/c/local/explorer");
  });

  // An Authorized Cluster Endpoint context talks to the cluster directly,
  // so it isn't Rancher's proxy and must not be labelled as such.
  it("leaves direct and malformed servers alone", () => {
    for (const s of ["https://10.0.0.5:6443", "https://prod.acme.io:6443/", "https://rancher.acme.io/k8s/clusters/", "http://rancher.acme.io/k8s/clusters/c-1", "https://rancher.acme.io/k8s/clusters/c-1/extra", "not a url", ""]) {
      expect(rancherCluster(s)).toBeNull();
    }
  });
});

describe("rancherProject", () => {
  it("reads the project from Rancher's annotation, else its label", () => {
    expect(rancherProject({ annotations: { "field.cattle.io/projectId": "c-m-abc12:p-xyz9" } })).toBe("p-xyz9");
    expect(rancherProject({ labels: { "field.cattle.io/projectId": "p-xyz9" } })).toBe("p-xyz9");
    expect(rancherProject({ labels: { app: "x" } })).toBe("");
    expect(rancherProject(undefined)).toBe("");
  });
});

describe("groupByProject", () => {
  it("groups namespaces by project, sorted, with the unassigned last", () => {
    expect(
      groupByProject([
        { name: "shop", project: "p-b" },
        { name: "kube-system", project: "" },
        { name: "api", project: "p-b" },
        { name: "cattle-system", project: "p-a" },
      ]),
    ).toEqual([
      { project: "p-a", names: ["cattle-system"] },
      { project: "p-b", names: ["api", "shop"] },
      { project: "", names: ["kube-system"] },
    ]);
  });

  it("is one flat group when nothing is in a project", () => {
    expect(groupByProject([{ name: "b", project: "" }, { name: "a", project: "" }])).toEqual([{ project: "", names: ["a", "b"] }]);
  });
});
