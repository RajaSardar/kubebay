import { describe, it, expect } from "vitest";
import { rolloutHistory } from "../rolloutHistory";

// The rollout line in a Deployment's drawer: how old the current revision is,
// and how many rollouts happened in the last 7 days, from the ReplicaSets the
// cluster keeps. No recording needed. Revisions are assigned 1, 2, 3… in
// order, one per rollout (a rollback included), so a ReplicaSet's creation
// time dates the revision it was created with, and the revisions between two
// dated ones happened between those dates.

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const deploy = { metadata: { uid: "dep-1", name: "api", namespace: "shop", creationTimestamp: ago(30 * DAY) } };

function rs(name: string, revision: number | undefined, created: string, opts: { history?: string; owner?: string } = {}) {
  const annotations: Record<string, string> = {};
  if (revision !== undefined) annotations["deployment.kubernetes.io/revision"] = String(revision);
  if (opts.history) annotations["deployment.kubernetes.io/revision-history"] = opts.history;
  return {
    metadata: {
      name,
      creationTimestamp: created,
      annotations,
      ownerReferences: [{ kind: "Deployment", name: "api", uid: opts.owner ?? "dep-1" }],
    },
  };
}

describe("rolloutHistory", () => {
  it("gives the current revision, when it was rolled out, and the rollouts in the last 7 days", () => {
    const h = rolloutHistory(
      deploy,
      [rs("api-1", 1, ago(30 * DAY)), rs("api-2", 2, ago(10 * DAY)), rs("api-3", 3, ago(5 * DAY)), rs("api-4", 4, ago(3 * DAY))],
      NOW,
    );
    expect(h).toEqual({ revision: 4, since: ago(3 * DAY), rollback: false, first: false, rolloutsThisWeek: 2, atLeast: false });
  });

  it("only counts ReplicaSets this Deployment owns", () => {
    const h = rolloutHistory(deploy, [rs("api-1", 1, ago(30 * DAY)), rs("web-9", 9, ago(DAY), { owner: "dep-2" })], NOW);
    expect(h?.revision).toBe(1);
    expect(h?.rolloutsThisWeek).toBe(0);
  });

  it("does not count creating the Deployment as a rollout", () => {
    const young = { metadata: { ...deploy.metadata, creationTimestamp: ago(2 * DAY) } };
    const h = rolloutHistory(young, [rs("api-1", 1, ago(2 * DAY))], NOW);
    expect(h).toEqual({ revision: 1, since: ago(2 * DAY), rollback: false, first: true, rolloutsThisWeek: 0, atLeast: false });
  });

  it("gives a rollback no age: its ReplicaSet was created long before it became current again", () => {
    // Rolled back from 3 to the template first shipped as 2: the controller
    // gives the old ReplicaSet revision 4 and records 2 as its history.
    const h = rolloutHistory(
      deploy,
      [rs("api-1", 1, ago(30 * DAY)), rs("api-2", 4, ago(10 * DAY), { history: "2" }), rs("api-3", 3, ago(2 * DAY))],
      NOW,
    );
    expect(h?.revision).toBe(4);
    expect(h?.rollback).toBe(true);
    expect(h?.since).toBeUndefined();
    // Revision 3 was created 2 days ago, so the rollback to 4 came after it.
    expect(h?.rolloutsThisWeek).toBe(2);
    expect(h?.atLeast).toBe(false);
  });

  it("gives no count when a rollback may or may not fall in the week", () => {
    // 1 and 2 are both older than a week; the rollback to 3 is undated.
    const h = rolloutHistory(deploy, [rs("api-1", 3, ago(30 * DAY), { history: "1" }), rs("api-2", 2, ago(20 * DAY))], NOW);
    expect(h?.rollback).toBe(true);
    expect(h?.rolloutsThisWeek).toBe(0);
    expect(h?.atLeast).toBe(true);
  });

  it("knows the first template after a rollback to it, so creating the Deployment still isn't a rollout", () => {
    const young = { metadata: { ...deploy.metadata, creationTimestamp: ago(3 * DAY) } };
    const h = rolloutHistory(young, [rs("api-1", 3, ago(3 * DAY), { history: "1" }), rs("api-2", 2, ago(2 * DAY))], NOW);
    expect(h?.rollback).toBe(true);
    expect(h?.first).toBe(false);
    expect(h?.rolloutsThisWeek).toBe(2);
    expect(h?.atLeast).toBe(false);
  });

  it("says 'at least' when every ReplicaSet kept is from this week, so older ones may have been pruned", () => {
    // revisionHistoryLimit: 2, so only 5, 6 and 7 are left; 2 to 4 may also
    // have been this week.
    const h = rolloutHistory(deploy, [rs("api-5", 5, ago(3 * DAY)), rs("api-6", 6, ago(2 * DAY)), rs("api-7", 7, ago(DAY))], NOW);
    expect(h?.rolloutsThisWeek).toBe(3);
    expect(h?.atLeast).toBe(true);
  });

  it("is exact when a ReplicaSet from before the week is still kept", () => {
    const h = rolloutHistory(deploy, [rs("api-4", 4, ago(9 * DAY)), rs("api-5", 5, ago(3 * DAY))], NOW);
    expect(h?.rolloutsThisWeek).toBe(1);
    expect(h?.atLeast).toBe(false);
  });

  it("returns null with no ReplicaSet carrying a revision, so the line does not render", () => {
    expect(rolloutHistory(deploy, [], NOW)).toBeNull();
    expect(rolloutHistory(deploy, [rs("api-x", undefined, ago(DAY))], NOW)).toBeNull();
    expect(rolloutHistory({ metadata: {} }, [rs("api-1", 1, ago(DAY))], NOW)).toBeNull();
  });
});
