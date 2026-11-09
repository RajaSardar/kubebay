import { describe, expect, it } from "vitest";
import { ansiSegments, logLevel, stripAnsi } from "../logLines";

// Root backlog #22: a pod's log lines coloured the way log tools do it (Loki,
// Kibana, Lens): by the level the line was logged at, and by the colours the
// app itself printed.

describe("logLevel", () => {
  it.each([
    // Structured logs say their level in a field: JSON, logfmt.
    ['{"level":"error","msg":"dial tcp: refused"}', "error"],
    ['{"severity":"WARNING","message":"slow"}', "warn"],
    ['{"lvl":"dbug","msg":"tick"}', "debug"],
    ['{"level":"info","msg":"listening"}', "info"],
    ['time=2026-11-09T10:00:00Z level=warn msg="disk 91% full"', "warn"],
    ["ts=1 lvl=crit msg=boom", "fatal"],
    // Go's klog and glog put it in the first letter: I, W, E, F and the date.
    ["E1109 10:00:00.000000       1 reflector.go:150] failed to list", "error"],
    ["W1109 10:00:00.000000       1 warnings.go:70] deprecated", "warn"],
    ["I1109 10:00:00.000000       1 main.go:12] started", "info"],
    ["F1109 10:00:00.000000       1 main.go:12] cannot start", "fatal"],
    // Otherwise the level word, in caps or brackets, anywhere in the line.
    ["2026-11-09 10:00:00 [ERROR] payment failed", "error"],
    ["2026-11-09 10:00:00 WARN  pool nearly exhausted", "warn"],
    ["2026-11-09 10:00:00 FATAL out of memory", "fatal"],
    ["panic: runtime error: index out of range", "fatal"],
    ["2026-11-09 DEBUG cache miss", "debug"],
    ["TRACE enter handler", "trace"],
    ["INFO  request served", "info"],
    ["Error: ENOENT, no such file", "error"],
    ["Traceback (most recent call last):", "error"],
    ["java.lang.NullPointerException: null", "error"],
    // Lines that say something worked.
    ["Successfully pulled image", "success"],
    ["migration completed successfully", "success"],
    ["Server is ready to accept connections", "success"],
    ["Listening on :8080", "success"],
    ['{"level":"info","msg":"build succeeded"}', "success"],
    // A level field wins over words in the message.
    ['level=info msg="no error found"', "info"],
    // Nothing to go on.
    ["GET /healthz 200 1ms", ""],
    ["0 errors, 0 warnings", ""],
  ])("%s → %s", (line, level) => {
    expect(logLevel(line)).toBe(level);
  });
});

describe("ansiSegments", () => {
  it("splits a line into the runs the app coloured, without the escape codes", () => {
    expect(ansiSegments("\x1b[31mERROR\x1b[0m payment failed")).toEqual([
      { text: "ERROR", color: "red", bold: false, dim: false },
      { text: " payment failed", color: "", bold: false, dim: false },
    ]);
  });

  it("keeps bold and bright colours, and resets on 0 and 39", () => {
    expect(ansiSegments("\x1b[1;92mok\x1b[39m done\x1b[0mx")).toEqual([
      { text: "ok", color: "green", bold: true, dim: false },
      { text: " done", color: "", bold: true, dim: false },
      { text: "x", color: "", bold: false, dim: false },
    ]);
  });

  it("drops 256-colour and true-colour codes it can't map to a theme colour, and other escapes", () => {
    expect(ansiSegments("\x1b[38;5;208mhot\x1b[0m \x1b[2K\x1b]0;title\x07\x1b[38;2;1;2;3mx")).toEqual([
      { text: "hot x", color: "", bold: false, dim: false },
    ]);
  });

  it("is one plain run for a line without escapes", () => {
    expect(ansiSegments("plain")).toEqual([{ text: "plain", color: "", bold: false, dim: false }]);
  });
});

describe("stripAnsi", () => {
  it("leaves the text the reader sees", () => {
    expect(stripAnsi("\x1b[33mWARN\x1b[0m slow \x1b[2Kquery")).toBe("WARN slow query");
  });
});
