// Screenshots of Kubebay against the demo cluster, for the launch kit.
const { chromium } = require("playwright");
const fs = require("fs");
const OUT = process.argv[2]; // output folder
const BASE = process.env.KB_URL || "http://127.0.0.1:9898";
const token = fs.readFileSync(process.env.KB_TOKEN_FILE, "utf8").trim();
const pages = (process.argv[3] || "workloads-overview,workloads,rbac,network-policy,topology,timeline,cost-waste,upgrade-readiness").split(",");

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((t) => { window.__KUBEBAY_TOKEN__ = t; }, token);
  await page.goto(BASE + "/");
  await page.waitForURL(/\/clusters/, { timeout: 20000 });
  await page.getByRole("row").filter({ hasText: "prod-eu-west" }).first().click();
  await page.waitForURL(/workloads-overview/, { timeout: 60000 });
  await page.waitForTimeout(8000);
  for (const p of pages) {
    const link = page.locator(`a[href="/${p}"]`).first();
    if (await link.isVisible()) await link.click();
    else await page.evaluate((u) => { history.pushState({}, "", u); dispatchEvent(new PopStateEvent("popstate")); }, "/" + p);
    await page.waitForTimeout(6000);
    if (p === "topology") { await page.locator("select").nth(1).selectOption("shop"); await page.waitForTimeout(5000); }
    await page.screenshot({ path: `${OUT}/${p}.png` });
    console.log("shot", p);
    for (const tab of (p === "workloads-overview" ? ["SPOF Radar", "Service Health"] : [])) {
      await page.getByRole("radio", { name: tab, exact: true }).first().check({ force: true });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${OUT}/${p}-${tab.toLowerCase().replace(/ /g, "-")}.png` });
      console.log("shot", p, tab);
    }
  }
  console.log("errors:", JSON.stringify(errors));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
