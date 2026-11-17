import { describe, expect, it } from "vitest";
import { cronNextRun, nextRunCell } from "../cron";

const at = (s: string) => new Date(s);
const next = (sched: string, from: string, tz?: string) => cronNextRun(sched, at(from), tz)?.toISOString() ?? null;

describe("cronNextRun", () => {
  it("every 5 minutes lands on the next multiple, strictly after now", () => {
    expect(next("*/5 * * * *", "2026-03-10T10:02:30Z")).toBe("2026-03-10T10:05:00.000Z");
    expect(next("*/5 * * * *", "2026-03-10T10:05:00Z")).toBe("2026-03-10T10:10:00.000Z");
  });
  it("daily rolls to tomorrow once today's slot has passed", () => {
    expect(next("30 2 * * *", "2026-03-10T01:00:00Z")).toBe("2026-03-10T02:30:00.000Z");
    expect(next("30 2 * * *", "2026-03-10T03:00:00Z")).toBe("2026-03-11T02:30:00.000Z");
  });
  it("supports lists, ranges and range steps", () => {
    expect(next("0 8,17 * * *", "2026-03-10T09:00:00Z")).toBe("2026-03-10T17:00:00.000Z");
    expect(next("0 9-17/4 * * *", "2026-03-10T10:00:00Z")).toBe("2026-03-10T13:00:00.000Z");
    expect(next("10/20 * * * *", "2026-03-10T10:11:00Z")).toBe("2026-03-10T10:30:00.000Z");
  });
  it("ORs day-of-month and day-of-week when both are restricted", () => {
    // 2026-03-10 is a Tuesday. "13th or any Friday": Fri 03-13 comes first.
    expect(next("0 0 13 * 5", "2026-03-10T00:00:00Z")).toBe("2026-03-13T00:00:00.000Z");
    // 1st or Monday: next Monday (03-16) is before April 1st.
    expect(next("0 0 1 * 1", "2026-03-10T00:00:00Z")).toBe("2026-03-16T00:00:00.000Z");
    // Only DOW restricted: AND with * DOM.
    expect(next("0 0 * * 0", "2026-03-10T00:00:00Z")).toBe("2026-03-15T00:00:00.000Z");
    // 7 is Sunday too.
    expect(next("0 0 * * 7", "2026-03-10T00:00:00Z")).toBe("2026-03-15T00:00:00.000Z");
  });
  it("understands month and day names", () => {
    expect(next("0 12 1 JAN *", "2026-03-10T00:00:00Z")).toBe("2027-01-01T12:00:00.000Z");
    expect(next("0 6 * * mon-fri", "2026-03-14T00:00:00Z")).toBe("2026-03-16T06:00:00.000Z");
  });
  it("understands @ macros", () => {
    expect(next("@hourly", "2026-03-10T10:20:00Z")).toBe("2026-03-10T11:00:00.000Z");
    expect(next("@daily", "2026-03-10T10:20:00Z")).toBe("2026-03-11T00:00:00.000Z");
    expect(next("@midnight", "2026-03-10T10:20:00Z")).toBe("2026-03-11T00:00:00.000Z");
    expect(next("@weekly", "2026-03-10T10:20:00Z")).toBe("2026-03-15T00:00:00.000Z");
    expect(next("@monthly", "2026-03-10T10:20:00Z")).toBe("2026-04-01T00:00:00.000Z");
    expect(next("@yearly", "2026-03-10T10:20:00Z")).toBe("2027-01-01T00:00:00.000Z");
    expect(next("@annually", "2026-03-10T10:20:00Z")).toBe("2027-01-01T00:00:00.000Z");
  });
  it("finds Feb 29", () => {
    expect(next("0 0 29 2 *", "2026-03-10T00:00:00Z")).toBe("2028-02-29T00:00:00.000Z");
  });
  it("honours a time zone", () => {
    expect(next("0 9 * * *", "2026-01-15T00:00:00Z", "America/New_York")).toBe("2026-01-15T14:00:00.000Z");
    // Summer: EDT is UTC-4.
    expect(next("0 9 * * *", "2026-07-15T00:00:00Z", "America/New_York")).toBe("2026-07-15T13:00:00.000Z");
    expect(next("0 9 * * *", "2026-01-15T00:00:00Z", "Asia/Kolkata")).toBe("2026-01-15T03:30:00.000Z");
  });
  it("returns null for invalid schedules or time zones", () => {
    for (const bad of ["", "* * * *", "* * * * * *", "61 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "a b c d e", "*/0 * * * *", "5-1 * * * *", "@sometimes"]) {
      expect(next(bad, "2026-03-10T00:00:00Z")).toBeNull();
    }
    expect(next("* * * * *", "2026-03-10T00:00:00Z", "Not/AZone")).toBeNull();
  });
  it("returns null when the date can never occur", () => {
    expect(next("0 0 31 2 *", "2026-03-10T00:00:00Z")).toBeNull();
  });
});

describe("nextRunCell", () => {
  const now = at("2026-03-10T10:00:00Z");
  it("shows a relative time with the absolute time as the title", () => {
    const c = nextRunCell({ spec: { schedule: "*/15 * * * *" } }, now);
    expect(c.v).toBe("in 15m");
    expect(c.title).toContain("2026-03-10");
  });
  it("uses spec.timeZone", () => {
    const c = nextRunCell({ spec: { schedule: "0 9 * * *", timeZone: "Asia/Kolkata" } }, now);
    expect(c.v).toBe("in 17h");
  });
  it("is an en dash when suspended or invalid", () => {
    expect(nextRunCell({ spec: { schedule: "* * * * *", suspend: true } }, now).v).toBe("–");
    expect(nextRunCell({ spec: { schedule: "nope" } }, now).v).toBe("–");
    expect(nextRunCell({ spec: {} }, now).v).toBe("–");
  });
});
