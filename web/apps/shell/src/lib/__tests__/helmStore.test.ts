import { describe, expect, it } from "vitest";
import { compareVersions, indexUpdatedLabel, installedAs, isWebUrl, matchesChart, releaseNameFor, versionInIndex } from "../helmStore";
import type { HelmChartEntry, HelmRelease } from "../api";

const chart = (over: Partial<HelmChartEntry> = {}): HelmChartEntry => ({
  name: "redis",
  description: "In-memory data store",
  version: "1.0.0",
  versions: 1,
  ...over,
});
const rel = (name: string, namespace: string, chartName: string): HelmRelease => ({
  name,
  namespace,
  chart: chartName,
  chartVersion: "1.0.0",
  status: "deployed",
  revision: 1,
});

// The store's cards say what's already installed. Release records keep a
// chart's name but not its repo, so the match is by chart name.
describe("installedAs", () => {
  it("lists the releases of a chart, by chart name", () => {
    const rels = [rel("cache", "shop", "redis"), rel("web", "shop", "nginx"), rel("sessions", "auth", "redis")];
    expect(installedAs(rels, "redis").map((r) => `${r.namespace}/${r.name}`)).toEqual(["shop/cache", "auth/sessions"]);
  });

  it("is empty for a chart nothing runs", () => {
    expect(installedAs([rel("web", "shop", "nginx")], "redis")).toEqual([]);
    expect(installedAs(undefined, "redis")).toEqual([]);
  });
});

describe("matchesChart", () => {
  it("matches name, description and keywords, ignoring case", () => {
    const c = chart({ keywords: ["cache", "KeyValue"] });
    expect(matchesChart(c, "")).toBe(true);
    expect(matchesChart(c, "REDIS")).toBe(true);
    expect(matchesChart(c, "memory")).toBe(true);
    expect(matchesChart(c, "keyvalue")).toBe(true);
    expect(matchesChart(c, "postgres")).toBe(false);
  });
});

// A chart's home and sources come from its repo, so only web links are links.
describe("isWebUrl", () => {
  it("accepts http and https only", () => {
    expect(isWebUrl("https://example.com/x")).toBe(true);
    expect(isWebUrl("http://example.com")).toBe(true);
    expect(isWebUrl("javascript:alert(1)")).toBe(false);
    expect(isWebUrl("file:///etc/passwd")).toBe(false);
    expect(isWebUrl("not a url")).toBe(false);
  });
});

describe("releaseNameFor", () => {
  it("is a chart's name made safe for a release name", () => {
    expect(releaseNameFor("My_Chart.v2")).toBe("my-chart-v2");
    expect(releaseNameFor("redis")).toBe("redis");
  });
});

describe("versionInIndex", () => {
  const versions = [{ version: "2.0.0" }, { version: "1.0.0" }];
  it("is true when the release's chart version is one this repository's index lists", () => {
    expect(versionInIndex(rel("cache", "shop", "redis"), versions)).toBe(true);
  });
  it("is false when it is not, so the release came from elsewhere or was pruned", () => {
    expect(versionInIndex({ ...rel("cache", "shop", "redis"), chartVersion: "0.5.0" }, versions)).toBe(false);
  });
});

describe("compareVersions", () => {
  const versions = [{ version: "3.0.0" }, { version: "2.0.0" }, { version: "1.0.0" }];
  it("compares the installed version with the newest when the chart runs", () => {
    expect(compareVersions(versions, [{ ...rel("a", "b", "redis"), chartVersion: "1.0.0" }])).toEqual({ from: "1.0.0", to: "3.0.0" });
  });
  it("compares the two newest versions otherwise", () => {
    expect(compareVersions(versions, [])).toEqual({ from: "2.0.0", to: "3.0.0" });
    expect(compareVersions(versions, [{ ...rel("a", "b", "redis"), chartVersion: "3.0.0" }])).toEqual({ from: "2.0.0", to: "3.0.0" });
    expect(compareVersions(versions, [{ ...rel("a", "b", "redis"), chartVersion: "9.9.9" }])).toEqual({ from: "2.0.0", to: "3.0.0" });
  });
  it("has nothing to compare with one version", () => {
    expect(compareVersions([{ version: "1.0.0" }], [])).toBeNull();
    expect(compareVersions([], [])).toBeNull();
  });
});

describe("indexUpdatedLabel", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  it("says how long ago the index was fetched", () => {
    expect(indexUpdatedLabel("2026-11-23T11:55:00Z", now)).toBe("Index updated 5m ago");
    expect(indexUpdatedLabel("2026-11-20T12:00:00Z", now)).toBe("Index updated 3d ago");
  });
  it("says when an index was never fetched", () => {
    expect(indexUpdatedLabel(undefined, now)).toBe("Index never fetched");
    expect(indexUpdatedLabel("not a time", now)).toBe("Index never fetched");
  });
  it("never shows a negative age for a clock a little ahead", () => {
    expect(indexUpdatedLabel("2026-11-23T12:00:30Z", now)).toBe("Index updated 0s ago");
  });
});
