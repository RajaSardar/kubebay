import { describe, it, expect } from "vitest";
import { shouldRedirectToPicker } from "../clusterPickerLogic";

// Regression: the app was unconditionally redirecting to /clusters on every
// mount, even when the user already had an active cluster. This caused the
// main app to be unreachable without clicking through the picker each time.
//
// Fix: only redirect to /clusters when there is no active cluster.
// If the user already selected a cluster (URL param or localStorage),
// let them land on their last page.

describe("shouldRedirectToPicker", () => {
  it("redirects when no active cluster and not already on /clusters", () => {
    expect(shouldRedirectToPicker("/workloads", "")).toBe(true);
  });

  it("skips redirect when active cluster is set", () => {
    expect(shouldRedirectToPicker("/workloads", "prod-cluster")).toBe(false);
  });

  it("skips redirect when already on /clusters (no double redirect)", () => {
    expect(shouldRedirectToPicker("/clusters", "")).toBe(false);
  });

  it("skips redirect on /clusters even with no active cluster", () => {
    expect(shouldRedirectToPicker("/clusters", "prod-cluster")).toBe(false);
  });

  it("redirects from / when no active cluster", () => {
    expect(shouldRedirectToPicker("/", "")).toBe(true);
  });

  it("does not redirect from / when cluster is active", () => {
    expect(shouldRedirectToPicker("/", "staging")).toBe(false);
  });
});
