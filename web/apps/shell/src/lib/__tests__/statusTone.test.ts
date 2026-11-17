import { describe, expect, it } from "vitest";
import { statusTone, type StatusTone } from "@kubebay/ui";

// Backlog #35: one mapping from a status word to its tone, used everywhere.
const CASES: [string, StatusTone][] = [
  ["Running", "ok"],
  ["Active", "ok"],
  ["Bound", "ok"],
  ["Ready", "ok"],
  ["Available", "ok"],
  ["Healthy", "ok"],
  ["Synced", "ok"],
  ["Pending", "pending"],
  ["ContainerCreating", "pending"],
  ["PodInitializing", "pending"],
  ["Init:0/2", "pending"],
  ["Progressing", "pending"],
  ["Succeeded", "done"],
  ["Completed", "done"],
  ["Complete", "done"],
  ["Failed", "err"],
  ["Error", "err"],
  ["CrashLoopBackOff", "err"],
  ["ImagePullBackOff", "err"],
  ["ErrImagePull", "err"],
  ["OOMKilled", "err"],
  ["CreateContainerConfigError", "err"],
  ["Init:CrashLoopBackOff", "err"],
  ["Lost", "err"],
  ["Evicted", "warn"],
  ["Released", "warn"],
  ["OutOfSync", "warn"],
  ["Degraded", "err"],
  ["Terminating", "terminating"],
  ["Unknown", "terminated"],
  ["SomethingNew", "terminated"],
  ["", "terminated"],
];

describe("statusTone", () => {
  it.each(CASES)("%s is %s", (word, tone) => {
    expect(statusTone(word)).toBe(tone);
  });

  it("gives every semantic group its own tone", () => {
    const tones = new Set(CASES.map(([, t]) => t));
    expect(tones).toEqual(new Set(["ok", "pending", "done", "err", "warn", "terminating", "terminated"]));
  });
});
