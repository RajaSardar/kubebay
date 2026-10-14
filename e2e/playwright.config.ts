import { defineConfig, devices } from "@playwright/test";

// KB-11. One serial flow against a running engine; see docs/E2E.md.
export default defineConfig({
  testDir: "./tests",
  timeout: 3 * 60_000,
  expect: { timeout: 30_000 },
  // A failure is a failure: no retries to hide a flake. Flakes are counted
  // against the budget in docs/E2E.md instead.
  retries: 0,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }], ["json", { outputFile: "results.json" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.KUBEBAY_URL ?? "http://127.0.0.1:9898",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
