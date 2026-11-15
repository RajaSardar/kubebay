import { describe, expect, it } from "vitest";
import { deniedStreams, listKinds } from "../forbidden";

// Pages that wait on several streams: the ones RBAC forbids, by name, with
// the API server's reason, so a page can say what it can't read instead of
// waiting on a sync that never comes.
describe("deniedStreams", () => {
  it("names the forbidden streams in the order given, with their reasons", () => {
    expect(
      deniedStreams({
        pods: { forbidden: "pods is forbidden" },
        nodes: {},
        deployments: { forbidden: "deployments.apps is forbidden" },
      }),
    ).toEqual([
      { what: "pods", reason: "pods is forbidden" },
      { what: "deployments", reason: "deployments.apps is forbidden" },
    ]);
  });

  it("is empty when nothing is forbidden", () => {
    expect(deniedStreams({ pods: {}, nodes: { forbidden: undefined } })).toEqual([]);
  });
});

describe("listKinds", () => {
  it("joins kinds as a sentence does", () => {
    expect(listKinds(["pods"])).toBe("pods");
    expect(listKinds(["pods", "nodes"])).toBe("pods and nodes");
    expect(listKinds(["pods", "nodes", "deployments"])).toBe("pods, nodes and deployments");
  });
});
