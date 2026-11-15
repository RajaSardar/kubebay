import { describe, expect, it } from "vitest";
import { chronicReason } from "../chronicReason";

// The 7-day chip names why a workload keeps breaking only when the recorded
// week says so plainly: a full week recorded, one specific reason behind at
// least half the broken hours, and never a vague one.

const week = { recordedHours: 131, recordedDays: 7, brokenDays: 4 };

describe("chronicReason", () => {
  it("names the reason behind most broken hours, in words with the code", () => {
    expect(chronicReason({ ...week, brokenHours: 9, reasons: { CrashLoopBackOff: 6, OOMKilled: 2 } })).toEqual({
      code: "CrashLoopBackOff",
      plain: "Keeps crashing on start",
    });
  });

  it("says nothing before a full week is recorded", () => {
    expect(chronicReason({ ...week, recordedDays: 6, brokenHours: 9, reasons: { CrashLoopBackOff: 9 } })).toBeNull();
  });

  it("says nothing when no reason covers half the broken hours, including hours recorded before reasons", () => {
    expect(chronicReason({ ...week, brokenHours: 9, reasons: { CrashLoopBackOff: 4, ImagePullBackOff: 3, OOMKilled: 2 } })).toBeNull();
    expect(chronicReason({ ...week, brokenHours: 9, reasons: { CrashLoopBackOff: 4 } })).toBeNull();
    expect(chronicReason({ ...week, brokenHours: 9 })).toBeNull();
  });

  it("never names a vague reason", () => {
    expect(chronicReason({ ...week, brokenHours: 9, reasons: { NotReady: 9 } })).toBeNull();
    expect(chronicReason({ ...week, brokenHours: 9, reasons: { Pending: 8, Unschedulable: 1 } })).toBeNull();
  });

  it("breaks a tie alphabetically, as the engine does", () => {
    expect(chronicReason({ ...week, brokenHours: 8, reasons: { OOMKilled: 4, CrashLoopBackOff: 4 } })?.code).toBe("CrashLoopBackOff");
  });
});
