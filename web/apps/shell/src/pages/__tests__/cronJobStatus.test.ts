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
