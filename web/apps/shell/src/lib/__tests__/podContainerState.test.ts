import { describe, it, expect } from "vitest";
import { describeLastState } from "../podContainerState";

describe("describeLastState", () => {
  it("returns null when there is no lastState", () => {
    expect(describeLastState(undefined)).toBeNull();
    expect(describeLastState({})).toBeNull();
  });

  it("returns null when lastState has no terminated entry (e.g. only 'running')", () => {
    expect(describeLastState({ running: { startedAt: "2026-09-01T00:00:00Z" } })).toBeNull();
  });

  it("extracts reason and exit code from a terminated last state", () => {
    const d = describeLastState({
      terminated: { reason: "OOMKilled", exitCode: 137, startedAt: "2026-09-01T00:00:00Z", finishedAt: "2026-09-01T00:02:13Z" },
    });
    expect(d).not.toBeNull();
    expect(d!.reason).toBe("OOMKilled");
    expect(d!.exitCode).toBe(137);
    expect(d!.startedAt).toBe("2026-09-01T00:00:00Z");
    expect(d!.finishedAt).toBe("2026-09-01T00:02:13Z");
  });

  it("computes how long the previous instance ran for", () => {
    const d = describeLastState({
      terminated: { reason: "Error", exitCode: 1, startedAt: "2026-09-01T00:00:00Z", finishedAt: "2026-09-01T00:02:13Z" },
    });
    expect(d!.ranFor).toBe("2m 13s");
  });

  it("formats a sub-minute duration in seconds only", () => {
    const d = describeLastState({
      terminated: { reason: "Error", exitCode: 1, startedAt: "2026-09-01T00:00:00Z", finishedAt: "2026-09-01T00:00:45Z" },
    });
    expect(d!.ranFor).toBe("45s");
  });

  it("formats an hour-plus duration with hours and minutes", () => {
    const d = describeLastState({
      terminated: { reason: "Error", exitCode: 1, startedAt: "2026-09-01T00:00:00Z", finishedAt: "2026-09-01T01:05:00Z" },
    });
    expect(d!.ranFor).toBe("1h 5m");
  });

  it("leaves ranFor null when either timestamp is missing", () => {
    const d = describeLastState({ terminated: { reason: "Error", exitCode: 1 } });
    expect(d!.ranFor).toBeNull();
  });
});
