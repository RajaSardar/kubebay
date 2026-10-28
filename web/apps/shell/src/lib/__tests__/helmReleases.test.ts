import { describe, expect, it } from "vitest";
import { helmRowsFromSecrets, mergeReleases, releasesFingerprint } from "../helmReleases";
import type { HelmRelease } from "../api";

// ADR 0004 S5: the Helm page's rows come first from the release Secrets'
// labels (Helm writes name, status and version on each), streamed from the
// moment a cluster connects; the chart columns fill in from the list.

const secret = (namespace: string, name: string, version: number, status: string, modifiedAt?: number) => ({
  metadata: {
    namespace,
    name: `sh.helm.release.v1.${name}.v${version}`,
    labels: { owner: "helm", name, version: String(version), status, ...(modifiedAt ? { modifiedAt: String(modifiedAt) } : {}) },
  },
});

describe("helmRowsFromSecrets", () => {
  it("keeps each release's newest revision, so an upgrade in progress wins over the deployed one", () => {
    const rows = helmRowsFromSecrets([
      secret("shop", "web", 2, "deployed", 1_700_000_000),
      secret("shop", "web", 3, "pending-upgrade", 1_700_000_100),
      secret("shop", "api", 7, "failed"),
      secret("shop", "api", 6, "deployed"),
      secret("data", "web", 1, "deployed"),
    ]);
    expect(rows).toEqual([
      { namespace: "data", name: "web", revision: 1, status: "deployed" },
      { namespace: "shop", name: "api", revision: 7, status: "failed" },
      { namespace: "shop", name: "web", revision: 3, status: "pending-upgrade", updated: new Date(1_700_000_100_000).toISOString() },
    ]);
  });

  it("skips Secrets that don't carry Helm's labels", () => {
    expect(helmRowsFromSecrets([{ metadata: { namespace: "shop", name: "x", labels: { owner: "helm" } } }, {}])).toEqual([]);
  });
});

const listed = (over: Partial<HelmRelease>): HelmRelease => ({
  name: "web",
  namespace: "shop",
  chart: "web",
  chartVersion: "1.0.0",
  appVersion: "2.0",
  status: "deployed",
  revision: 2,
  updated: "2026-10-28T09:00:00Z",
  ...over,
});

describe("mergeReleases", () => {
  it("takes revision and status from the stream and the chart from the list", () => {
    const rows = mergeReleases([{ namespace: "shop", name: "web", revision: 3, status: "pending-upgrade" }], [listed({})]);
    expect(rows).toEqual([listed({ revision: 3, status: "pending-upgrade" })]);
  });

  it("shows a release the list doesn't have yet, without its chart", () => {
    expect(mergeReleases([{ namespace: "shop", name: "new", revision: 1, status: "deployed" }], [])).toEqual([
      { namespace: "shop", name: "new", revision: 1, status: "deployed", chart: "", chartVersion: "" },
    ]);
  });

  it("is the list alone until the stream has anything", () => {
    expect(mergeReleases(null, [listed({})])).toEqual([listed({})]);
  });
});

describe("releasesFingerprint", () => {
  it("changes when a release moves on, not when rows come in another order", () => {
    const a = { namespace: "shop", name: "web", revision: 2, status: "deployed" };
    const b = { namespace: "shop", name: "api", revision: 1, status: "deployed" };
    expect(releasesFingerprint([a, b])).toBe(releasesFingerprint([b, a]));
    expect(releasesFingerprint([a, b])).not.toBe(releasesFingerprint([{ ...a, revision: 3 }, b]));
    expect(releasesFingerprint([a, b])).not.toBe(releasesFingerprint([{ ...a, status: "failed" }, b]));
  });
});
