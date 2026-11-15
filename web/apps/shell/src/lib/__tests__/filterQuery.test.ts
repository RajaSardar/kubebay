import { describe, expect, it } from "vitest";
import { matchesQuery, parseQuery, type QueryRow } from "../filterQuery";

// #25: the filter field understands `key:value` (docs/TABLE_FOLLOWUPS.md).

const pod: QueryRow = {
  text: ["web-7f9c", "shop", "Running", "node-1"],
  fields: { name: "web-7f9c", ns: "shop", status: "Running", node: "node-1", ip: "10.0.0.4" },
  labels: { app: "web", tier: "frontend" },
};
const crash: QueryRow = {
  text: ["cart-1", "shop", "CrashLoopBackOff", "node-2"],
  fields: { name: "cart-1", ns: "shop", status: "CrashLoopBackOff", node: "node-2", ip: "10.0.0.5" },
  labels: { app: "cart" },
};
const keys = ["status", "node", "ip"];
const m = (row: QueryRow, q: string) => matchesQuery(row, parseQuery(q, keys));

describe("filter syntax", () => {
  it("plain words still match any shown text, every word must match, case ignored", () => {
    expect(m(pod, "WEB shop")).toBe(true);
    expect(m(pod, "web cart")).toBe(false);
  });

  it("ns:, name: and a column's key match that field only", () => {
    expect(m(pod, "ns:shop")).toBe(true);
    expect(m(pod, "ns:data")).toBe(false);
    expect(m(crash, "status:crash")).toBe(true);
    expect(m(pod, "status:crash")).toBe(false);
    expect(m(pod, "node:node-1 ip:10.0.0.4")).toBe(true);
    expect(m(pod, "name:shop")).toBe(false);
  });

  it("label:k=v matches exactly, label:k means the label exists", () => {
    expect(m(pod, "label:app=web")).toBe(true);
    expect(m(pod, "label:app=we")).toBe(false);
    expect(m(pod, "label:tier")).toBe(true);
    expect(m(crash, "label:tier")).toBe(false);
    expect(m(pod, "l:app=web")).toBe(true);
  });

  it("a leading - negates a token or a word", () => {
    expect(m(pod, "-status:crash")).toBe(true);
    expect(m(crash, "-status:crash")).toBe(false);
    expect(m(pod, "-cart")).toBe(true);
    expect(m(crash, "ns:shop -label:app=cart")).toBe(false);
  });

  it("an unknown key stays text, so system:node still matches as written", () => {
    const sa: QueryRow = { text: ["system:node:worker"], fields: { name: "system:node:worker" } };
    expect(m(sa, "system:node")).toBe(true);
    expect(parseQuery("system:node", keys).terms).toEqual([{ text: "system:node", neg: false }]);
  });

  it("a key with no value yet (still typing) filters nothing", () => {
    expect(m(pod, "status:")).toBe(true);
    expect(m(pod, "-")).toBe(true);
  });

  it("reports which tokens it understood, for the hint under the field", () => {
    expect(parseQuery("ns:shop -label:app=web nginx", keys).tokens).toEqual([
      { key: "ns", value: "shop", neg: false },
      { key: "label", value: "app=web", neg: true },
    ]);
  });
});
