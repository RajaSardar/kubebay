import { describe, expect, it } from "vitest";
import {
  changeObjectHref,
  changesQuery,
  describeFields,
  layoutBands,
  RETENTION_CHOICES,
  type TimelineChange,
} from "../timeline";

const base: TimelineChange = {
  id: 1,
  cluster: "kind-dev",
  ts: "2026-03-01T12:00:00Z",
  group: "apps",
  version: "v1",
  resource: "deployments",
  kind: "Deployment",
  namespace: "shop",
  name: "api",
  op: "update",
};

describe("changesQuery", () => {
  it("names the cluster and drops empty filters", () => {
    expect(changesQuery({ cluster: "kind-dev", namespace: "", kind: "Deployment", manager: "", from: "", to: "" })).toBe(
      "cluster=kind-dev&kind=Deployment",
    );
  });
  it("encodes values and carries the cursor and limit", () => {
    const q = changesQuery({ cluster: "a b", manager: "kubectl-client-side-apply", from: "2026-03-01T00:00:00Z", cursor: "9:3", limit: 50 });
    expect(q).toContain("cluster=a%20b");
    expect(q).toContain("from=2026-03-01T00%3A00%3A00Z");
    expect(q).toContain("cursor=9%3A3");
    expect(q).toContain("limit=50");
  });
});

describe("layoutBands", () => {
  const from = "2026-03-01T00:00:00Z";
  const to = "2026-03-01T10:00:00Z";
  it("places each gap as a percentage of the window", () => {
    const [b] = layoutBands([{ from: "2026-03-01T02:00:00Z", to: "2026-03-01T05:00:00Z", reason: "watch stopped" }], from, to);
    expect(b!.left).toBeCloseTo(20);
    expect(b!.width).toBeCloseTo(30);
    expect(b!.reason).toBe("watch stopped");
  });
  it("clips to the window and drops what falls outside it", () => {
    const bands = layoutBands(
      [
        { from: "2026-02-28T00:00:00Z", to: "2026-03-01T01:00:00Z", reason: "a" },
        { from: "2026-03-02T00:00:00Z", to: "2026-03-02T01:00:00Z", reason: "b" },
      ],
      from,
      to,
    );
    expect(bands).toHaveLength(1);
    expect(bands[0]!.left).toBe(0);
    expect(bands[0]!.width).toBeCloseTo(10);
  });
  it("is empty for an empty or inverted window", () => {
    expect(layoutBands([{ from, to, reason: "x" }], to, from)).toEqual([]);
  });
});

describe("describeFields", () => {
  it("lists paths and counts the rest", () => {
    expect(describeFields({ ...base, fields: [{ path: "spec.replicas", kind: "changed" }], moreFields: 3 })).toBe("spec.replicas (+3 more)");
  });
  it("says metadata only when the watch could not see more", () => {
    expect(describeFields({ ...base, fields: [{ path: "metadata.labels.app", kind: "added" }], metadataOnly: true })).toBe(
      "metadata.labels.app (metadata only)",
    );
  });
  it("is blank for an add or delete", () => {
    expect(describeFields({ ...base, op: "add" })).toBe("");
  });
});

describe("changeObjectHref", () => {
  it("opens the object through the generic detail route", () => {
    expect(changeObjectHref(base)).toBe("/detail/deployments/shop/api");
  });
  it("opens a pod in its drawer", () => {
    expect(changeObjectHref({ ...base, resource: "pods", kind: "Pod" })).toBe("/workloads?pod=shop%2Fapi");
  });
  it("opens an event's involved object, not the event", () => {
    expect(changeObjectHref({ ...base, op: "event", resource: "events", kind: "Event", involvedKind: "Deployment", involvedName: "api" })).toBe(
      "/detail/deployments/shop/api",
    );
  });
  it("has no link for a deleted object", () => {
    expect(changeObjectHref({ ...base, op: "delete" })).toBeNull();
  });
});

describe("RETENTION_CHOICES", () => {
  it("offers off through 30 days, default 7 included", () => {
    expect(RETENTION_CHOICES.map((c) => c.days)).toEqual([0, 1, 3, 7, 14, 30]);
  });
});
