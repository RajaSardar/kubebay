import { describe, expect, it } from "vitest";
import { lastLogLine } from "../lastLogLine";

describe("lastLogLine", () => {
  it("is the last line with text in it", () => {
    expect(lastLogLine(["starting", "panic: DB_URL not set", "", "   "])).toBe("panic: DB_URL not set");
  });

  it("is null when there is nothing to show", () => {
    expect(lastLogLine([])).toBeNull();
    expect(lastLogLine(["", "  "])).toBeNull();
  });

  it("drops a leading container-runtime timestamp and colour codes, and trims", () => {
    expect(lastLogLine(["2026-10-03T18:01:02.123456789Z   \u001b[31mfatal: boom\u001b[0m  "])).toBe("fatal: boom");
  });

  it("cuts a long line to 160 characters with an ellipsis", () => {
    const out = lastLogLine(["x".repeat(300)])!;
    expect(out).toHaveLength(160);
    expect(out.endsWith("…")).toBe(true);
  });
});
