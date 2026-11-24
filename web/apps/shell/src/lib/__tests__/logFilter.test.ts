import { describe, expect, it } from "vitest";
import { filterLogLines } from "../logFilter";

describe("filterLogLines", () => {
  const lines = [
    "I1112 10:00:00.000000 1 a.go:1] started",
    "W1112 10:00:01.000000 1 a.go:2] slow",
    "E1112 10:00:02.000000 1 a.go:3] boom",
    '{"level":"warn","msg":"x"}',
    "ts=1 level=error msg=bad",
    "2026-01-01 FATAL out of memory",
    "just some prose line",
    "",
  ];

  it("keeps everything when the problems filter is off", () => {
    const r = filterLogLines(lines, { text: "", problemsOnly: false });
    expect(r.shown).toEqual(lines);
    expect(r.hidden).toBe(0);
  });

  it("keeps only warn and error lines and counts the rest as hidden", () => {
    const r = filterLogLines(lines, { text: "", problemsOnly: true });
    expect(r.shown).toEqual([lines[1], lines[2], lines[3], lines[4], lines[5]]);
    expect(r.hidden).toBe(3);
  });

  it("combines with the text filter and counts only text matches the level filter hid", () => {
    const r = filterLogLines(lines, { text: "boom", problemsOnly: true });
    expect(r.shown).toEqual([lines[2]]);
    expect(r.hidden).toBe(0);
  });

  it("treats an unfiltered text match on a non-problem line as hidden", () => {
    const r = filterLogLines(lines, { text: "started", problemsOnly: true });
    expect(r.shown).toEqual([]);
    expect(r.hidden).toBe(1);
  });
});
