import { beforeEach, describe, expect, it } from "vitest";
import { compareSemver, LAST_SEEN_KEY, readLastSeen, releasesToShow, writeLastSeen, type WhatsNewRelease } from "../whatsNew";

const rel = (version: string): WhatsNewRelease => ({
  version,
  date: "2026-01-01",
  sections: [{ heading: "Added", items: [{ title: `T${version}`, summary: "" }] }],
});
const all = [rel("unreleased"), rel("0.7.3"), rel("0.7.2"), rel("0.7.1"), rel("0.1.3")];
const versions = (r: WhatsNewRelease[]) => r.map((x) => x.version);

describe("compareSemver", () => {
  it("compares numerically, not as text", () => {
    expect(compareSemver("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("0.7.1", "0.7.2")).toBeLessThan(0);
  });
  it("ignores a leading v", () => {
    expect(compareSemver("v0.7.2", "0.7.2")).toBe(0);
  });
  it("ranks a pre-release below its release", () => {
    expect(compareSemver("0.8.0-rc.1", "0.8.0")).toBeLessThan(0);
  });
  it("returns null for anything that is not semver", () => {
    expect(compareSemver("dev", "0.1.0")).toBeNull();
    expect(compareSemver("0.1.0", "")).toBeNull();
  });
});

describe("releasesToShow", () => {
  it("lists the releases after the last seen, up to the current, newest first", () => {
    expect(versions(releasesToShow(all, "0.7.1", "0.7.3"))).toEqual(["0.7.3", "0.7.2"]);
  });
  it("includes every release a user skipped", () => {
    expect(versions(releasesToShow(all, "0.1.3", "v0.7.3"))).toEqual(["0.7.3", "0.7.2", "0.7.1"]);
  });
  it("never includes unreleased notes", () => {
    expect(versions(releasesToShow(all, "0.7.2", "0.7.3"))).not.toContain("unreleased");
  });
  it("shows nothing on a first run (nothing last seen)", () => {
    expect(releasesToShow(all, null, "0.7.3")).toEqual([]);
  });
  it("shows nothing when the versions are equal", () => {
    expect(releasesToShow(all, "0.7.3", "0.7.3")).toEqual([]);
    expect(releasesToShow(all, "v0.7.3", "0.7.3")).toEqual([]);
  });
  it("shows nothing for a dev build or an unreadable version", () => {
    expect(releasesToShow(all, "0.7.1", "dev")).toEqual([]);
    expect(releasesToShow(all, "garbage", "0.7.3")).toEqual([]);
  });
  it("shows nothing after a downgrade", () => {
    expect(releasesToShow(all, "0.7.3", "0.7.1")).toEqual([]);
  });
  it("shows nothing when the changelog has no newer release", () => {
    expect(releasesToShow(all, "0.7.3", "0.7.4")).toEqual([]);
  });
});

describe("last seen version", () => {
  beforeEach(() => localStorage.clear());
  it("uses kb.lastSeenVersion", () => {
    writeLastSeen("0.7.3");
    expect(LAST_SEEN_KEY).toBe("kb.lastSeenVersion");
    expect(localStorage.getItem("kb.lastSeenVersion")).toBe("0.7.3");
    expect(readLastSeen()).toBe("0.7.3");
  });
  it("reads null when nothing is stored", () => {
    expect(readLastSeen()).toBeNull();
  });
});
