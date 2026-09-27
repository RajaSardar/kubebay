import { describe, it, expect } from "vitest";
import { matchesSelector } from "../labelSelector";

describe("matchesSelector", () => {
  it("matches when all matchLabels are present and equal", () => {
    expect(matchesSelector({ app: "web", tier: "frontend" }, { matchLabels: { app: "web" } })).toBe(true);
  });

  it("does not match when a matchLabels key is missing", () => {
    expect(matchesSelector({ tier: "frontend" }, { matchLabels: { app: "web" } })).toBe(false);
  });

  it("does not match when a matchLabels value differs", () => {
    expect(matchesSelector({ app: "api" }, { matchLabels: { app: "web" } })).toBe(false);
  });

  it("an empty selector matches everything", () => {
    expect(matchesSelector({ anything: "x" }, {})).toBe(true);
  });

  it("supports matchExpressions In", () => {
    expect(matchesSelector({ env: "prod" }, { matchExpressions: [{ key: "env", operator: "In", values: ["prod", "staging"] }] })).toBe(true);
    expect(matchesSelector({ env: "dev" }, { matchExpressions: [{ key: "env", operator: "In", values: ["prod", "staging"] }] })).toBe(false);
  });

  it("supports matchExpressions NotIn", () => {
    expect(matchesSelector({ env: "dev" }, { matchExpressions: [{ key: "env", operator: "NotIn", values: ["prod"] }] })).toBe(true);
    expect(matchesSelector({ env: "prod" }, { matchExpressions: [{ key: "env", operator: "NotIn", values: ["prod"] }] })).toBe(false);
  });

  it("supports matchExpressions Exists", () => {
    expect(matchesSelector({ env: "prod" }, { matchExpressions: [{ key: "env", operator: "Exists" }] })).toBe(true);
    expect(matchesSelector({}, { matchExpressions: [{ key: "env", operator: "Exists" }] })).toBe(false);
  });

  it("supports matchExpressions DoesNotExist", () => {
    expect(matchesSelector({}, { matchExpressions: [{ key: "env", operator: "DoesNotExist" }] })).toBe(true);
    expect(matchesSelector({ env: "prod" }, { matchExpressions: [{ key: "env", operator: "DoesNotExist" }] })).toBe(false);
  });

  it("requires both matchLabels and matchExpressions to pass when both are set", () => {
    const selector = { matchLabels: { app: "web" }, matchExpressions: [{ key: "env", operator: "In", values: ["prod"] }] };
    expect(matchesSelector({ app: "web", env: "prod" }, selector)).toBe(true);
    expect(matchesSelector({ app: "web", env: "dev" }, selector)).toBe(false);
  });
});
