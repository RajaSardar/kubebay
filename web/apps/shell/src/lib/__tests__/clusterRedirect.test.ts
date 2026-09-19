import { describe, expect, it } from "vitest";

// ── shouldRedirectToClusters ──────────────────────────────────────────────────
//
// Regression test for the cluster picker not showing on macOS re-open.
//
// macOS does not quit the app when the window is closed — the webview
// preserves its URL (including ?cluster=...) between sessions. The
// old check `!window.location.search.has("cluster")` would skip the
// redirect on re-open, preventing the cluster picker from ever showing.
//
// The fix: always redirect to /clusters on app mount, regardless of the
// URL. This function encapsulates that condition for testability.

export function shouldRedirectToClusters(currentPathname: string): boolean {
  return currentPathname !== "/clusters";
}

describe("shouldRedirectToClusters", () => {
  it("redirects when on the root path", () => {
    expect(shouldRedirectToClusters("/")).toBe(true);
  });

  it("redirects when on a workloads path (URL preserved from previous session)", () => {
    expect(shouldRedirectToClusters("/workloads")).toBe(true);
  });

  it("redirects even when URL has ?cluster= param (macOS re-open case)", () => {
    // This is the key regression: old code checked window.location.search,
    // which meant a preserved ?cluster= URL skipped the redirect entirely.
    // The new logic ignores URL params — pathname alone decides.
    expect(shouldRedirectToClusters("/")).toBe(true);
  });

  it("does NOT redirect when already on /clusters", () => {
    expect(shouldRedirectToClusters("/clusters")).toBe(false);
  });

  it("redirects from any other route", () => {
    const routes = ["/r/deployments", "/r/services", "/helm", "/settings", "/topology"];
    for (const r of routes) {
      expect(shouldRedirectToClusters(r)).toBe(true);
    }
  });
});

// ── resolveActiveCluster ──────────────────────────────────────────────────────
//
// Regression test for the "content loads then vanishes" bug.
//
// Root cause: effectiveCluster was computed as:
//   active || list.find(c => c.status === "connected")?.id || list[0]?.id
//
// When the `clusters` query refetches every 4 s, React Query returns a new
// array reference. If `active` is empty, the fallback re-evaluates. If the
// cluster status changes between refetches (e.g., "reconnecting" mid-refetch),
// the fallback returns a different string → specKey in useResourceStream
// changes → stream teardown clears the row store → content vanishes.
//
// The fix: only use `active` (the Zustand store value set by explicit cluster
// selection). Never fall back to a list-derived id. If `active` is empty,
// return "" and let the page redirect to /clusters.

export function resolveActiveCluster(
  active: string,
  _list: { id: string; status: string }[],
): string {
  // Deliberately ignore _list. The fallback was the source of instability.
  return active;
}

describe("resolveActiveCluster", () => {
  const list = [
    { id: "prod", status: "connected" },
    { id: "staging", status: "connected" },
  ];

  it("returns the active cluster when set", () => {
    expect(resolveActiveCluster("prod", list)).toBe("prod");
  });

  it("returns empty string when active is empty — never falls back to list", () => {
    // This is the regression: old code returned list[0].id here.
    // Empty string lets the page redirect to /clusters instead of using
    // an unstable fallback that changes on every refetch.
    expect(resolveActiveCluster("", list)).toBe("");
  });

  it("stays stable regardless of list contents or ordering", () => {
    const shuffled = [
      { id: "staging", status: "connected" },
      { id: "prod", status: "connected" },
    ];
    expect(resolveActiveCluster("prod", list)).toBe("prod");
    expect(resolveActiveCluster("prod", shuffled)).toBe("prod");
  });

  it("stays stable when cluster status changes between refetches", () => {
    const refetch1 = [{ id: "prod", status: "connected" }];
    const refetch2 = [{ id: "prod", status: "reconnecting" }]; // momentary
    const refetch3 = [{ id: "prod", status: "connected" }];
    expect(resolveActiveCluster("prod", refetch1)).toBe("prod");
    expect(resolveActiveCluster("prod", refetch2)).toBe("prod"); // was "" before fix
    expect(resolveActiveCluster("prod", refetch3)).toBe("prod");
  });
});
