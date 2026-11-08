// A ~25 s tour recorded as video, for the README hero GIF.
const { chromium } = require("playwright");
const fs = require("fs");
const BASE = process.env.KB_URL || "http://127.0.0.1:9898";
const token = fs.readFileSync(process.env.KB_TOKEN_FILE, "utf8").trim();
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 }, recordVideo: { dir: OUT, size: { width: 1280, height: 760 } } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => { window.__KUBEBAY_TOKEN__ = t; }, token);
  await page.goto(BASE + "/"); await page.waitForURL(/\/clusters/);
  await page.waitForTimeout(1500);
  await page.getByRole("row").filter({ hasText: "prod-eu-west" }).first().click();
  await page.waitForURL(/workloads-overview/, { timeout: 60000 });
  await page.getByText("Failing", { exact: true }).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  await page.getByRole("radio", { name: "SPOF Radar", exact: true }).check({ force: true });
  await page.waitForTimeout(4500);
  await page.locator('a[href="/rbac"]').first().click();
  await page.waitForTimeout(5500);
  await page.getByText("Network", { exact: true }).first().click(); await page.waitForTimeout(700);
  await page.locator('a[href="/network-policy"]').first().click();
  await page.waitForTimeout(4500);
  await page.locator('a[href="/workloads"]').first().click();
  await page.waitForTimeout(4000);
  await ctx.close(); await b.close();
  console.log("video in", OUT);
})();
