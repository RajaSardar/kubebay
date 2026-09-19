import { describe, expect, it } from "vitest";
import { extraColumns } from "../ResourceTable";

// ── pod columns ──────────────────────────────────────────────────────────────

describe("extraColumns('pods') – Ready", () => {
  const { Ready } = extraColumns("pods");

  it("shows ready/total from containerStatuses", () => {
    const cell = Ready!({
      status: {
        phase: "Running",
        containerStatuses: [
          { ready: true, restartCount: 0 },
          { ready: true, restartCount: 0 },
        ],
      },
      spec: { containers: [{}, {}] },
    });
    expect(cell.v).toBe("2/2");
    expect(cell.dot).toBe("ok");
  });

  it("shows err dot when no containers are ready", () => {
    const cell = Ready!({
      status: {
        phase: "Running",
        containerStatuses: [
          { ready: false, restartCount: 0 },
        ],
      },
      spec: { containers: [{}] },
    });
    expect(cell.v).toBe("0/1");
    expect(cell.dot).toBe("err");
  });

  it("shows warn dot when some containers are ready", () => {
    const cell = Ready!({
      status: {
        phase: "Running",
        containerStatuses: [
          { ready: true, restartCount: 0 },
          { ready: false, restartCount: 0 },
        ],
      },
      spec: { containers: [{}, {}] },
    });
    expect(cell.v).toBe("1/2");
    expect(cell.dot).toBe("warn");
  });

  it("shows ok dot for Succeeded phase", () => {
    const cell = Ready!({
      status: { phase: "Succeeded", containerStatuses: [] },
      spec: { containers: [] },
    });
    expect(cell.dot).toBe("ok");
  });

  it("shows err dot for Failed phase", () => {
    const cell = Ready!({
      status: { phase: "Failed", containerStatuses: [] },
      spec: { containers: [] },
    });
    expect(cell.dot).toBe("err");
  });

  it("falls back to spec.containers length when containerStatuses absent", () => {
    const cell = Ready!({
      status: { phase: "Pending" },
      spec: { containers: [{}, {}, {}] },
    });
    expect(cell.v).toBe("0/3");
  });
});

describe("extraColumns('pods') – Restarts", () => {
  const { Restarts } = extraColumns("pods");

  it("sums restartCount across all containers", () => {
    const cell = Restarts!({
      status: {
        containerStatuses: [
          { restartCount: 3 },
          { restartCount: 2 },
        ],
      },
    });
    expect(cell.v).toBe("5");
    expect(cell.dot).toBe("warn"); // >0 but <=5
  });

  it("shows err dot when restarts exceed 5", () => {
    const cell = Restarts!({
      status: {
        containerStatuses: [{ restartCount: 7 }],
      },
    });
    expect(cell.v).toBe("7");
    expect(cell.dot).toBe("err");
  });

  it("shows no dot when restarts are zero", () => {
    const cell = Restarts!({
      status: {
        containerStatuses: [{ restartCount: 0 }],
      },
    });
    expect(cell.v).toBe("0");
    expect(cell.dot).toBeUndefined();
  });

  it("handles missing containerStatuses gracefully", () => {
    const cell = Restarts!({ status: {} });
    expect(cell.v).toBe("0");
    expect(cell.dot).toBeUndefined();
  });
});

describe("extraColumns('pods') – Node and Pod IP", () => {
  const cols = extraColumns("pods");

  it("extracts nodeName", () => {
    const cell = cols["Node"]!({ spec: { nodeName: "ip-10-0-1-2.ec2.internal" } });
    expect(cell.v).toBe("ip-10-0-1-2.ec2.internal");
  });

  it("shows dash when nodeName absent", () => {
    const cell = cols["Node"]!({ spec: {} });
    expect(cell.v).toBe("–");
  });

  it("extracts podIP", () => {
    const cell = cols["Pod IP"]!({ status: { podIP: "10.0.1.42" } });
    expect(cell.v).toBe("10.0.1.42");
  });

  it("shows dash when podIP absent", () => {
    const cell = cols["Pod IP"]!({ status: {} });
    expect(cell.v).toBe("–");
  });
});

// ── events columns ───────────────────────────────────────────────────────────

describe("extraColumns('events') – Type", () => {
  const { Type } = extraColumns("events");

  it("marks Warning events with warn dot", () => {
    const cell = Type!({ type: "Warning" });
    expect(cell.v).toBe("Warning");
    expect(cell.dot).toBe("warn");
  });

  it("marks Normal events with ok dot", () => {
    const cell = Type!({ type: "Normal" });
    expect(cell.v).toBe("Normal");
    expect(cell.dot).toBe("ok");
  });

  it("defaults to ok for missing type", () => {
    const cell = Type!({});
    expect(cell.dot).toBe("ok");
  });
});

describe("extraColumns('events') – Reason", () => {
  const { Reason } = extraColumns("events");

  it("returns the reason string", () => {
    expect(Reason!({ reason: "BackOff" }).v).toBe("BackOff");
  });

  it("shows dash when reason absent", () => {
    expect(Reason!({}).v).toBe("–");
  });
});

describe("extraColumns('events') – Object", () => {
  const { Object: ObjectCol } = extraColumns("events");

  it("formats involvedObject as Kind/name", () => {
    const cell = ObjectCol!({ involvedObject: { kind: "Pod", name: "nginx-abc" } });
    expect(cell.v).toBe("Pod/nginx-abc");
  });

  it("shows dash when involvedObject is missing", () => {
    expect(ObjectCol!({}).v).toBe("–");
  });
});

describe("extraColumns('events') – Message", () => {
  const { Message } = extraColumns("events");

  it("truncates to 80 chars", () => {
    const long = "x".repeat(120);
    const cell = Message!({ message: long });
    expect(cell.v).toHaveLength(80);
  });

  it("returns full message when under 80 chars", () => {
    const cell = Message!({ message: "Back-off restarting failed container" });
    expect(cell.v).toBe("Back-off restarting failed container");
  });

  it("adds mono small class", () => {
    const cell = Message!({ message: "hello" });
    expect(cell.cls).toBe("mono small");
  });
});

describe("extraColumns('events') – Count", () => {
  const { Count } = extraColumns("events");

  it("returns the count as a string", () => {
    expect(Count!({ count: 42 }).v).toBe("42");
  });

  it("defaults to 1 when count is absent", () => {
    expect(Count!({}).v).toBe("1");
  });
});

// ── unknown slug returns empty ────────────────────────────────────────────────

describe("extraColumns for unknown slug", () => {
  it("returns an empty object for unrecognised slugs", () => {
    expect(extraColumns("unknownresource")).toEqual({});
  });
});
