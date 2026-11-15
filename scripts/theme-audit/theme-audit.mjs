#!/usr/bin/env node
// 12-theme accessibility audit of the running app.
//
// Starts the built engine (engine/bin/kubebay, from `make build`) against an
// offline kubeconfig, then in every theme renders the token gate, the cluster
// catalog and Settings, and measures, against each element's real composited
// background:
//   - text contrast (4.5:1; 3:1 for large text and icons; HC themes report <7:1),
//   - the edges of inputs, selects and segmented controls (3:1),
//   - the keyboard focus ring of every focusable control (visible, 3:1).
// Exits 1 if anything fails. docs/DESIGN_SYSTEM.md rule 6 asks for this before
// a design-system change merges.
//
//   node scripts/theme-audit/theme-audit.mjs [--shots <dir>]
//
// Needs Playwright and a Chromium: PLAYWRIGHT_MODULE (path to playwright's
// index.mjs) and CHROMIUM (executable) override the defaults.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");

const THEMES = ["dawn", "dusk", "dawn-hc", "dusk-hc", "vscode-dark", "vscode-light", "one-dark", "dracula", "nord", "github-dark", "github-light", "catppuccin"];
const HC = new Set(["dawn-hc", "dusk-hc"]);
const PORT = 9899;
const shotsIdx = process.argv.indexOf("--shots");
const shots = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

// Runs in the page. Returns the failures on the current screen.
const auditFn = ({ hc }) => {
    const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0],p[1],p[2],p[3] ?? 1]; };
    const over = (f,b) => [0,1,2].map(i => f[i]*f[3] + b[i]*(1-f[3])).concat(1);
    const lum = ([r,g,b]) => { const f = v => (v/=255) <= .03928 ? v/12.92 : ((v+.055)/1.055)**2.4; return .2126*f(r)+.7152*f(g)+.0722*f(b); };
    const cr = (a,b) => { const x = lum(a), y = lum(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
    const bgOf = el => { const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e); let bg = parse(getComputedStyle(document.documentElement).backgroundColor) || [255,255,255,1]; if (bg[3] === 0) bg = parse(getComputedStyle(document.body).backgroundColor) || [255,255,255,1]; if (bg[3] < 1) bg = over(bg,[255,255,255,1]); for (const e of chain.reverse()) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) bg = over(c, bg); } return bg; };
    const opac = el => { let o = 1; for (let e = el; e; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
    const exempt = el => el.closest('[disabled],[aria-disabled="true"],[data-terminating],.status-terminated,.status-terminating,[aria-hidden="true"]');
    const desc = el => (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''));
    const fails = [], hcWarn = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
      const isIcon = el.tagName.toLowerCase() === 'svg' && !el.closest('.art');
      if (!hasText && !isIcon) continue;
      if (exempt(el) && !isIcon) continue;
      if (opac(el) === 0) continue; // revealed on hover or focus (row kebab)
      const bg = bgOf(el);
      let fg = parse(cs.color); if (!fg) continue;
      const o = opac(el); fg = [fg[0],fg[1],fg[2],fg[3]*o];
      const ratio = cr(over(fg,bg), bg);
      const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700;
      const large = size >= 24 || (bold && size >= 18.66);
      const min = isIcon ? 3 : large ? 3 : 4.5;
      const text = isIcon ? '[icon]' : [...el.childNodes].filter(n => n.nodeType===3).map(n=>n.textContent.trim()).join(' ').slice(0,40);
      const key = desc(el) + '|' + text;
      if (seen.has(key)) continue; seen.add(key);
      if (ratio < min) fails.push(`${text} (${desc(el)}) ${ratio.toFixed(2)} < ${min}`);
      else if (hc && !isIcon && !large && ratio < 7) hcWarn.push(`${text} (${desc(el)}) ${ratio.toFixed(2)} < 7`);
    }
    // control edges: inputs, selects, segmented groups vs the ground behind them
    const edges = [];
    for (const el of document.querySelectorAll('input:not([type=checkbox]), select, .kb-segmented')) {
      const cs = getComputedStyle(el); const bc = parse(cs.borderTopColor); if (!bc) continue;
      const outer = bgOf(el.parentElement); const inner = bgOf(el);
      const ratio = Math.max(cr(over(bc,outer),outer), cr(over(bc,inner),inner));
      if (ratio < 3) edges.push(`${desc(el)} edge ${ratio.toFixed(2)} < 3`);
    }
    // focus rings (transitions off so the settled style is read)
    const st = document.createElement('style'); st.textContent = '*,*::before,*::after{transition:none !important}'; document.head.appendChild(st);
    const rings = [];
    for (const el of document.querySelectorAll('button:not([disabled]), a[href], input, select, [tabindex="0"]')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      if (!el.getClientRects().length) continue; // inside a collapsed group
      el.focus(); if (document.activeElement !== el) continue; const cs = getComputedStyle(el);
      const m = cs.boxShadow.match(/rgba?\([^)]+\)/g); const col = m ? parse(m[m.length-1]) : (cs.outlineStyle !== 'none' ? parse(cs.outlineColor) : null);
      if (!col) { rings.push(`${desc(el)} has no visible focus ring`); continue; }
      const bg = bgOf(el.parentElement || el); const ratio = cr(over(col,bg),bg);
      if (ratio < 3) rings.push(`${desc(el)} ring ${ratio.toFixed(2)} < 3`);
      el.blur();
    }
    return { fails, hcWarn, edges, rings: [...new Set(rings)], scroll: document.documentElement.scrollHeight, scrollW: document.documentElement.scrollWidth };
  };

const engine = join(root, "engine/bin/kubebay");
if (!existsSync(engine)) throw new Error("engine/bin/kubebay not found: run `make build` first");
const tokenFile = join(mkdtempSync(join(tmpdir(), "kb-audit-")), "session-token");
const proc = spawn(engine, ["--addr", `127.0.0.1:${PORT}`, "--token-file", tokenFile], {
  env: { ...process.env, KUBEBAY_KUBECONFIG: join(here, "offline-kubeconfig.yaml") },
  stdio: "ignore",
});
const base = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 40 && !existsSync(tokenFile); i++) await new Promise((r) => setTimeout(r, 250));
const tok = readFileSync(tokenFile, "utf8").trim();

const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
let total = 0;
try {
  for (const th of THEMES) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((t) => { localStorage.setItem("kb.theme.version", "2"); localStorage.setItem("kb.theme", t); }, th);
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base, { waitUntil: "networkidle" });
    // Keyboard modality, so :focus-visible rings show as they would for a keyboard user.
    await p.keyboard.press("Tab");
    const out = { gate: await p.evaluate(auditFn, { hc: HC.has(th) }) };
    await p.fill("input", tok);
    await p.getByRole("button", { name: "Connect" }).click();
    await p.waitForTimeout(2500);
    if (await p.getByRole("button", { name: "Connect" }).count()) throw new Error("login failed");
    await p.keyboard.press("Tab");
    out.catalog = await p.evaluate(auditFn, { hc: HC.has(th) });
    // The session token lives in memory, so navigate in-app rather than reloading.
    await p.evaluate(() => { history.pushState({}, "", "/settings"); dispatchEvent(new PopStateEvent("popstate")); });
    await p.waitForTimeout(1500);
    await p.keyboard.press("Tab");
    out.settings = await p.evaluate(auditFn, { hc: HC.has(th) });
    if (shots) await p.screenshot({ path: join(shots, `settings-${th}.png`), fullPage: true });
    for (const [pg, r] of Object.entries(out)) {
      const issues = [...r.fails.map((f) => "TEXT " + f), ...r.edges.map((f) => "EDGE " + f), ...r.rings.map((f) => "FOCUS " + f)];
      if (issues.length) {
        total += issues.length;
        console.log(`${th} / ${pg}`);
        for (const i of issues) console.log("  " + i);
      }
    }
    if (errs.length) { total += errs.length; console.log(th, "PAGE ERRORS", errs.join(" | ")); }
    await ctx.close();
  }
} finally {
  await b.close();
  proc.kill();
}
console.log(`theme audit: ${total} issue(s) across ${THEMES.length} themes`);
process.exit(total ? 1 : 0);
