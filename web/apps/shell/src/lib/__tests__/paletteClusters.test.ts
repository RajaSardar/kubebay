import { describe, expect, it } from "vitest";
import { clusterChoices, matchClusters } from "../paletteClusters";
import type { ClusterInfo } from "../api";

const info = (id: string, context: string, status: ClusterInfo["status"] = "reachable", connected = false): ClusterInfo => ({
  id,
  context,
  server: "https://x",
  status,
  connected,
});

const clusters = [
  info("prod-eu", "arn:aws:eks:eu-west-1:1:cluster/prod-eu-cluster", "reachable", true),
  info("stage", "stage-ctx"),
  info("lab", "lab", "unreachable"),
  info("broken", "broken", "misconfigured"),
  info("secret-one", "secret-one"),
];
const meta = {
  stage: { alias: "Staging", lastUsed: 300 },
  "prod-eu": { pinned: true, lastUsed: 100 },
  lab: { lastUsed: 200 },
  "secret-one": { hidden: true },
};

const choices = clusterChoices(clusters, meta, "prod-eu");
const names = (l: { name: string }[]) => l.map((c) => c.name);

describe("clusterChoices", () => {
  it("names a cluster as the Clusters page does, with its alias first, and drops hidden ones", () => {
    expect(names(choices).sort()).toEqual(["Staging", "broken", "lab", "prod-eu-cluster"].sort());
  });

  it("marks the current cluster and whether one can be opened", () => {
    expect(choices.find((c) => c.id === "prod-eu")!.current).toBe(true);
    expect(choices.find((c) => c.id === "broken")!.usable).toBe(false);
    expect(choices.find((c) => c.id === "lab")!.usable).toBe(true);
  });
});

describe("matchClusters", () => {
  it("offers the clusters you used most recently when the box is empty, never the current one", () => {
    const r = matchClusters(choices, "", 4);
    expect(r.intent).toBe(false);
    expect(names(r.list)).toEqual(["Staging", "lab", "broken"]);
  });

  it("finds a cluster by typing part of its name, without any keyword", () => {
    expect(names(matchClusters(choices, "stag", 4).list)).toEqual(["Staging"]);
  });

  it("finds it by id or kubeconfig context too", () => {
    expect(names(matchClusters(choices, "stage-ctx", 4).list)).toEqual(["Staging"]);
  });

  it("does not match on a single letter, which would list half the clusters for every search", () => {
    expect(matchClusters(choices, "s", 4).list).toEqual([]);
  });

  it("lists every other cluster for 'switch' and a space", () => {
    const r = matchClusters(choices, "switch ", 10);
    expect(r.intent).toBe(true);
    expect(names(r.list)).toEqual(["Staging", "lab", "broken"]);
  });

  it("narrows with more words after the keyword", () => {
    expect(names(matchClusters(choices, "switch sta", 10).list)).toEqual(["Staging"]);
    expect(names(matchClusters(choices, "cluster lab", 10).list)).toEqual(["lab"]);
    expect(names(matchClusters(choices, "ctx:lab", 10).list)).toEqual(["lab"]);
  });

  it("treats @ as 'a cluster'", () => {
    expect(matchClusters(choices, "@sta", 10).intent).toBe(true);
    expect(names(matchClusters(choices, "@sta", 10).list)).toEqual(["Staging"]);
    expect(names(matchClusters(choices, "@", 10).list)).toEqual(["Staging", "lab", "broken"]);
  });

  it("ranks a name that starts with the text ahead of one that only contains it", () => {
    const more = clusterChoices([info("alpha-prod", "alpha-prod"), info("prod-main", "prod-main")], {}, "x");
    expect(names(matchClusters(more, "switch prod", 10).list)).toEqual(["prod-main", "alpha-prod"]);
  });

  it("keeps a lone word like 'switch' searchable as an ordinary word until you press space", () => {
    expect(matchClusters(choices, "switch", 4).intent).toBe(false);
  });

  it("limits the list", () => {
    expect(matchClusters(choices, "switch ", 2).list).toHaveLength(2);
  });
});
