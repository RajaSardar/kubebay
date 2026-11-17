import { describe, expect, it } from "vitest";
import { statusTone } from "@kubebay/ui";
import { extraColumns } from "../ResourceTable";

const status = (o: Record<string, unknown>) => extraColumns("cronjobs").Status!(o);

describe("cronjobs Status column", () => {
  it("is Suspended when spec.suspend is true, even with active jobs", () => {
    const c = status({ spec: { suspend: true }, status: { active: [{ name: "a" }] } });
    expect(c.v).toBe("Suspended");
    expect(c.pill).toBe(true);
    expect(statusTone(c.v)).toBe("warn");
  });
  it("is Active when jobs are running", () => {
    const c = status({ spec: { suspend: false }, status: { active: [{ name: "a" }, { name: "b" }] } });
    expect(c.v).toBe("Active");
    expect(statusTone(c.v)).toBe("ok");
    expect(extraColumns("cronjobs")["Active Jobs"]!({ status: { active: [{}, {}] } }).v).toBe("2");
  });
  it("is Idle when scheduled with no running jobs", () => {
    const c = status({ spec: {}, status: {} });
    expect(c.v).toBe("Idle");
    expect(c.pill).toBe(true);
  });
});

describe("cronjobs Next Schedule column", () => {
  const next = (o: Record<string, unknown>) => extraColumns("cronjobs")["Next Schedule"]!(o);
  it("shows a relative time with the absolute time as the title", () => {
    const c = next({ spec: { schedule: "* * * * *" } });
    expect(c.v).toMatch(/^in \d+m$/);
    expect(c.title).toBeTruthy();
  });
  it("is an en dash when suspended or the schedule is invalid", () => {
    expect(next({ spec: { schedule: "* * * * *", suspend: true } }).v).toBe("–");
    expect(next({ spec: { schedule: "bogus" } }).v).toBe("–");
  });
});
