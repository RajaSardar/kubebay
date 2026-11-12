import { describe, expect, it } from "vitest";
import { ansiSegments, logLevel, stripAnsi } from "../logLevels";

// Backlog #22: pod logs coloured the way log tools do it: errors red,
// warnings amber, success green, debug dimmed. The level comes from the
// line's own structure (JSON, logfmt, klog, a bracketed or capitalised level
// word) rather than any mention of "error" in prose.

describe("logLevel", () => {
  it("reads the level a structured log line declares", () => {
    expect(logLevel('{"time":"…","level":"error","msg":"db down"}')).toBe("error");
    expect(logLevel('{"severity":"WARNING","message":"slow"}')).toBe("warn");
    expect(logLevel('{"lvl":"info","msg":"ok"}')).toBe("info");
    expect(logLevel('{"level":30,"msg":"pino uses numbers"}')).toBe("info");
    expect(logLevel('{"level":50,"msg":"pino error"}')).toBe("error");
    expect(logLevel("ts=2026-11-12 level=warn msg=retrying")).toBe("warn");
    expect(logLevel('level="debug" msg="cache hit"')).toBe("debug");
  });

  it("reads klog's E/W/I/F prefixes", () => {
    expect(logLevel("E1112 10:00:01.123456       1 reflector.go:150] failed to list")).toBe("error");
    expect(logLevel("W1112 10:00:01.123456       1 warnings.go:70] deprecated")).toBe("warn");
    expect(logLevel("I1112 10:00:01.123456       1 main.go:20] started")).toBe("info");
    expect(logLevel("F1112 10:00:01.123456       1 main.go:20] fatal")).toBe("error");
  });

  it("reads a level word: capitalised anywhere, or any case in brackets", () => {
    expect(logLevel("2026-11-12 10:00:00 ERROR [main] db down")).toBe("error");
    expect(logLevel("2026/11/12 10:00:00 [error] 7#7: connect() failed")).toBe("error");
    expect(logLevel("10:00:00 FATAL out of memory")).toBe("error");
    expect(logLevel("10:00:00 WARN slow query")).toBe("warn");
    expect(logLevel("[warning] disk at 85%")).toBe("warn");
    expect(logLevel("10:00:00 INFO listening on :8080")).toBe("info");
    expect(logLevel("10:00:00 DEBUG cache miss")).toBe("debug");
    expect(logLevel("TRACE enter handler")).toBe("debug");
  });

  it("reads an exception or a failure without a level", () => {
    expect(logLevel("Error: connect ECONNREFUSED 10.0.0.1:5432")).toBe("error");
    expect(logLevel("panic: runtime error: index out of range")).toBe("error");
    expect(logLevel("Traceback (most recent call last):")).toBe("error");
    expect(logLevel("upload failed after 3 attempts")).toBe("error");
    expect(logLevel("0 succeeded, 3 failed")).toBe("error");
  });

  it("marks success", () => {
    expect(logLevel("Migration completed successfully")).toBe("success");
    expect(logLevel("job succeeded in 3s")).toBe("success");
    expect(logLevel('{"level":"info","msg":"deploy succeeded"}')).toBe("success");
    expect(logLevel("loguru SUCCESS | all good")).toBe("success");
  });

  it("doesn't read a level into prose", () => {
    expect(logLevel("served 0 errors in the last hour")).toBe("");
    expect(logLevel("errorHandler registered")).toBe("");
    expect(logLevel("the request was unsuccessful")).toBe("");
    expect(logLevel("GET /info 200")).toBe("");
    expect(logLevel("")).toBe("");
  });

  it("reads past the colours an app adds", () => {
    expect(logLevel("\x1b[31mERROR\x1b[0m db down")).toBe("error");
  });
});

describe("ansi colours", () => {
  it("strips escape codes", () => {
    expect(stripAnsi("\x1b[1;31mERROR\x1b[0m db \x1b[2Kdown")).toBe("ERROR db down");
  });

  it("splits a line into the app's coloured runs, as theme tones", () => {
    expect(ansiSegments("plain")).toBeNull();
    expect(ansiSegments("\x1b[31mERROR\x1b[0m db \x1b[1;32mok\x1b[0m")).toEqual([
      { text: "ERROR", tone: "err" },
      { text: " db " },
      { text: "ok", tone: "ok", bold: true },
    ]);
    expect(ansiSegments("\x1b[33mW\x1b[39m \x1b[90mdim\x1b[0m \x1b[36mcyan")).toEqual([
      { text: "W", tone: "warn" },
      { text: " " },
      { text: "dim", tone: "muted" },
      { text: " " },
      { text: "cyan", tone: "info" },
    ]);
  });
});
