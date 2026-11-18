import { describe, expect, it } from "vitest";
import { installedAs, isWebUrl, matchesChart, releaseNameFor } from "../helmStore";
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
