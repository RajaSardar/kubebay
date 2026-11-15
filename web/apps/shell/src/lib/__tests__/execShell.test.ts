import { describe, it, expect } from "vitest";
import { shellCandidates } from "../execShell";

describe("shellCandidates", () => {
  it("keeps the existing pod-exec ladders unchanged", () => {
    expect(shellCandidates("auto")).toEqual([["bash", "-l"], ["sh"], ["ash"]]);
    expect(shellCandidates("bash")).toEqual([["bash", "-l"]]);
    expect(shellCandidates("sh")).toEqual([["sh"]]);
    expect(shellCandidates("ash")).toEqual([["ash"]]);
    expect(shellCandidates("powershell")).toEqual([["powershell"]]);
  });

  it("falls back to auto for an unrecognized shell mode", () => {
    expect(shellCandidates("nope" as never)).toEqual(shellCandidates("auto"));
  });

  it("enters the host's mount/UTS/IPC/net/PID namespaces for the node shell mode, not the helper pod's own", () => {
    const candidates = shellCandidates("node");
    for (const c of candidates) {
      expect(c.slice(0, 8)).toEqual(["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p"]);
      expect(c[8]).toBe("--");
    }
  });

  it("offers a bash/sh/ash fallback ladder for the node shell, same recovery mechanism as pod exec", () => {
    const candidates = shellCandidates("node");
    expect(candidates.map((c) => c.slice(9))).toEqual([["bash", "-l"], ["sh", "-l"], ["ash", "-l"]]);
  });
});
