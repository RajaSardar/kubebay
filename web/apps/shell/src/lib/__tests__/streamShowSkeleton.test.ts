import { describe, it, expect } from "vitest";
import { shouldShowSkeleton } from "../useResourceStream";

// The skeleton should appear ONLY when there is genuinely no data yet.
// It must NOT appear just because synced=false (re-syncing) when the
// stream cache already has rows — that would cause the stuck-skeleton
// regression on large remote clusters (EKS) where re-sync takes 5-15s.

describe("shouldShowSkeleton", () => {
  it("shows skeleton on initial load (no rows, not synced)", () => {
    expect(shouldShowSkeleton(false, 0)).toBe(true);
  });

  it("hides skeleton when cached rows exist even while re-syncing", () => {
    expect(shouldShowSkeleton(false, 5)).toBe(false);
  });

  it("hides skeleton when synced with zero rows (empty namespace)", () => {
    expect(shouldShowSkeleton(true, 0)).toBe(false);
  });

  it("hides skeleton when synced with rows", () => {
    expect(shouldShowSkeleton(true, 10)).toBe(false);
  });
});
