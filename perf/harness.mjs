#!/usr/bin/env node
// KB-02 steps 2 and 3: measure the engine binary against a real cluster and
// write perf.json. Linux only: memory and CPU come from /proc.
//
//   node perf/harness.mjs --engine engine/bin/kubebay --kubeconfig KUBECONFIG --context CONTEXT \
//     [--pods 1000,10000] [--runs 5] [--settle 20] [--paint-samples 30] [--scroll-rows 100000] \
//     [--out perf/perf.json] [--chromium PATH]
//
// What each number means, and what it leaves out, is in docs/PERFORMANCE.md.

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, platform, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { decode, encode } from "@msgpack/msgpack";
import { chromium } from "playwright-core";
import { aliasContexts, cpuTicks, frameStats, listedPods, median, percentile, podsList, rssMB, snapshotFrames } from "./lib.mjs";

const TOKEN = "kubebay-perf";
const NAMESPACE = "kubebay-perf";
// The watch-to-paint pods, kept apart so the watch counts never see them.
const PAINT_NAMESPACE = "kubebay-perf-paint";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const opts = {
  engine: arg("engine", "engine/bin/kubebay"),
  kubeconfig: arg("kubeconfig", process.env.KUBECONFIG),
  context: arg("context"),
  pods: arg("pods", "1000,10000").split(",").map(Number),
  runs: Number(arg("runs", "5")),
  settleMs: Number(arg("settle", "20")) * 1000,
  paintSamples: Number(arg("paint-samples", "30")),
  scrollRows: Number(arg("scroll-rows", "100000")),
  out: arg("out", "perf/perf.json"),
  chromium: arg("chromium"),
};
if (!opts.kubeconfig || !opts.context) {
  console.error("--kubeconfig (or KUBECONFIG) and --context are required");
  process.exit(2);
}

const round = (x) => Math.round(x);
const kubectl = (args, input) =>
  execFileSync("kubectl", ["--kubeconfig", opts.kubeconfig, "--context", opts.context, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 64 << 20,
    stdio: ["pipe", "pipe", "pipe"],
  });

async function freePort() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

/** Starts the engine with its own home and port; resolves once /api/healthz answers. */
async function startEngine(kubeconfig = opts.kubeconfig) {
  const home = mkdtempSync(join(tmpdir(), "kubebay-perf-"));
  const port = await freePort();
  const t0 = performance.now();
  const proc = spawn(
    opts.engine,
    ["--addr", `127.0.0.1:${port}`, "--no-open", "--kubeconfig", kubeconfig, "--token-file", join(home, "session-token")],
    { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), KUBEBAY_TOKEN: TOKEN }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  const keep = (d) => (log = (log + d).slice(-8000));
  proc.stdout.on("data", keep);
  proc.stderr.on("data", keep);
  const base = `http://127.0.0.1:${port}`;
  for (;;) {
    if (proc.exitCode !== null) throw new Error(`engine exited with ${proc.exitCode}:\n${log}`);
    try {
      if ((await fetch(`${base}/api/healthz`)).ok) break;
    } catch {
      // not listening yet
    }
    if (performance.now() - t0 > 30_000) throw new Error(`engine not ready in 30 s:\n${log}`);
    await sleep(5);
  }
  const readyMs = performance.now() - t0;
  const stop = async () => {
    proc.kill("SIGTERM");
    await Promise.race([once(proc, "exit"), sleep(10_000, undefined, { ref: false }).then(() => proc.kill("SIGKILL"))]);
    rmSync(home, { recursive: true, force: true });
  };
  return { proc, base, port, readyMs, stop };
}

async function connect(engine, context = opts.context) {
  const r = await fetch(`${engine.base}/api/clusters/${encodeURIComponent(context)}/connect`, {
    method: "POST",
    headers: { "X-Kubebay-Token": TOKEN },
  });
  if (!r.ok) throw new Error(`connect ${context}: ${r.status} ${await r.text()}`);
}

/** Median RSS of a few samples a second apart. */
async function sampleRss(pid, n = 5) {
  const xs = [];
  for (let i = 0; i < n; i++) {
    if (i) await sleep(1000);
    xs.push(rssMB(readFileSync(`/proc/${pid}/status`, "utf8")));
  }
  return median(xs);
}

const clockTicks = Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim());

/** Average CPU, in percent of one core, over `seconds`. */
async function cpuPercent(pid, seconds) {
  const read = () => cpuTicks(readFileSync(`/proc/${pid}/stat`, "utf8"));
  const before = read();
  await sleep(seconds * 1000);
  return Math.round(((read() - before) / clockTicks / seconds) * 1000) / 10;
}

async function newPage(browser, base, activeCluster) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // The desktop app hands the page its token the same way, so there's no token gate.
  await ctx.addInitScript(
    ([token, cluster]) => {
      window.__KUBEBAY_TOKEN__ = token;
      if (cluster) sessionStorage.setItem("kubebay.activeCluster", cluster);
    },
    [TOKEN, activeCluster],
  );
  return { ctx, page: await ctx.newPage() };
}

/** Engine start to /api/healthz, then navigation to the cluster list painted with the cluster on it. */
async function coldStart(browser) {
  const runs = [];
  for (let i = 0; i < opts.runs; i++) {
    const engine = await startEngine();
    const { ctx, page } = await newPage(browser, engine.base);
    await page.goto(`${engine.base}/clusters`, { waitUntil: "commit" });
    await page.locator("tr", { hasText: opts.context }).first().waitFor({ timeout: 30_000 });
    // The next frame is the one that shows it.
    const firstFrameMs = await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(performance.now()))));
    runs.push({ engineReadyMs: round(engine.readyMs), firstFrameMs: round(firstFrameMs), totalMs: round(engine.readyMs + firstFrameMs) });
    await ctx.close();
    await engine.stop();
  }
  const pick = (k) => median(runs.map((r) => r[k]));
  return { runs, engineReadyMs: pick("engineReadyMs"), firstFrameMs: pick("firstFrameMs"), totalMs: pick("totalMs") };
}

/** `clusters` clusters connected, the app open on the first one's overview, nobody touching it. */
async function idle(browser, clusters = 1) {
  // More than one: the same cluster under more context names, which the
  // engine connects to and health-checks as separate clusters.
  const dir = mkdtempSync(join(tmpdir(), "kubebay-perf-kubeconfig-"));
  const config = aliasContexts(JSON.parse(kubectl(["config", "view", "--raw", "--minify", "-o", "json"])), opts.context, clusters);
  const kubeconfig = join(dir, "kubeconfig.json");
  writeFileSync(kubeconfig, JSON.stringify(config));
  const engine = await startEngine(kubeconfig);
  for (const c of config.contexts) await connect(engine, c.name);
  const { ctx, page } = await newPage(browser, engine.base, opts.context);
  await page.goto(`${engine.base}/workloads-overview`);
  await sleep(opts.settleMs);
  const result = { clusters, rssMB: await sampleRss(engine.proc.pid), cpuPercent: await cpuPercent(engine.proc.pid, 10) };
  await ctx.close();
  await engine.stop();
  rmSync(dir, { recursive: true, force: true });
  return result;
}

/** `kubectl proxy` on a free port: the API server over plain HTTP, so a create is one fetch. */
async function apiProxy() {
  const p = spawn("kubectl", ["--kubeconfig", opts.kubeconfig, "--context", opts.context, "proxy", "--port=0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`kubectl proxy didn't start: ${out}`)), 15_000);
    const read = (d) => {
      out += d;
      const m = /Starting to serve on (127\.0\.0\.1:\d+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve(`http://${m[1]}`);
      }
    };
    p.stdout.on("data", read);
    p.stderr.on("data", read);
    p.on("exit", (code) => reject(new Error(`kubectl proxy exited with ${code}: ${out}`)));
  });
  return { base, stop: () => p.kill() };
}

/**
 * The Pods page open, filtered to the paint pods. Creates them one at a time
 * and times each from the create request to the frame that shows its row.
 * Each pod's name sorts before the last one's, so its row lands at the top.
 */
async function paint(browser) {
  try {
    kubectl(["create", "namespace", PAINT_NAMESPACE]);
  } catch {
    // already there
  }
  kubectl(["-n", PAINT_NAMESPACE, "delete", "pods", "--all", "--wait=true"]);
  const proxy = await apiProxy();
  const engine = await startEngine();
  await connect(engine);
  const { ctx, page } = await newPage(browser, engine.base, opts.context);
  await page.goto(`${engine.base}/workloads?q=perf-paint-`);
  await page.getByText("No pods match.").waitFor({ timeout: 30_000 });
  // The row's frame, on the wall clock both sides share: the observer sees the
  // row go into the DOM, and the next animation frame is the one that shows it.
  await page.evaluate(() => {
    window.__paint = {};
    new MutationObserver(() => {
      const want = window.__paintWant;
      if (!want || want in window.__paint || !document.querySelector(`td.td-name[title="${want}"]`)) return;
      window.__paint[want] = 0;
      requestAnimationFrame(() => (window.__paint[want] = performance.timeOrigin + performance.now()));
    }).observe(document.body, { childList: true, subtree: true });
  });
  const now = () => performance.timeOrigin + performance.now();
  const samples = [];
  const writes = [];
  for (let i = 0; i < opts.paintSamples; i++) {
    const name = `perf-paint-${String(999 - i).padStart(3, "0")}`;
    const pod = podsList(PAINT_NAMESPACE, i, 1).items[0];
    pod.metadata.name = name;
    await page.evaluate((n) => (window.__paintWant = n), name);
    const t0 = now();
    const r = await fetch(`${proxy.base}/api/v1/namespaces/${PAINT_NAMESPACE}/pods`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pod),
    });
    writes.push(now() - t0);
    if (!r.ok) throw new Error(`create ${name}: ${r.status} ${await r.text()}`);
    const painted = await page.waitForFunction((n) => window.__paint[n] || null, name, { timeout: 10_000, polling: 50 });
    samples.push((await painted.jsonValue()) - t0);
    // Apart, so each pod is its own watch event and its own frame.
    await sleep(250);
  }
  await ctx.close();
  await engine.stop();
  proxy.stop();
  kubectl(["-n", PAINT_NAMESPACE, "delete", "pods", "--all", "--wait=true"]);
  return {
    samples: samples.length,
    runsMs: samples.map(round),
    p50Ms: round(percentile(samples, 50)),
    p95Ms: round(percentile(samples, 95)),
    maxMs: round(Math.max(...samples)),
    writeMs: round(median(writes)),
  };
}

/**
 * The Pods page scrolled for 5 s through `rows` pods. The rows are synthetic:
 * the harness answers the page's pods subscription itself, frame for frame as
 * the engine would, so the cluster doesn't need that many pods. The engine
 * serves everything else.
 */
async function scroll(browser, rows) {
  const engine = await startEngine();
  await connect(engine);
  const { ctx, page } = await newPage(browser, engine.base, opts.context);
  const pods = listedPods(NAMESPACE, rows, new Date().toISOString());
  const ours = new Set();
  await page.routeWebSocket(/\/ws$/, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((msg) => {
      const f = typeof msg === "string" ? JSON.parse(msg) : null;
      if (f?.gvr === "v1/pods" && (f.type === "sub" || f.type === "resync")) {
        ours.add(f.id);
        ws.send(JSON.stringify({ type: "ack", id: f.id, message: "subscribed" }));
        for (const frame of snapshotFrames(f.id, pods)) ws.send(Buffer.from(encode(frame)));
        ws.send(JSON.stringify({ type: "sync", id: f.id }));
        return;
      }
      if (f?.type === "unsub" && ours.has(f.id)) return;
      server.send(msg);
    });
  });
  const t0 = performance.now();
  await page.goto(`${engine.base}/workloads`);
  await page.locator('td.td-name[title="perf-00000"]').waitFor({ timeout: 120_000 });
  const loadMs = round(performance.now() - t0);
  await sleep(1000);
  // About 6,000 px a second at 60 fps: a fast flick down the table, one step a frame.
  const run = await page.evaluate(
    ([seconds, step]) =>
      new Promise((resolve) => {
        const el = document.querySelector(".table-wrap");
        const stamps = [];
        const tick = (t) => {
          stamps.push(t);
          if (t - stamps[0] >= seconds * 1000) {
            const names = [...document.querySelectorAll("td.td-name")].map((td) => td.title);
            resolve({ stamps, lastRow: names[names.length - 1] });
            return;
          }
          el.scrollTop += step;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [5, 100],
  );
  await ctx.close();
  await engine.stop();
  return { rows, loadMs, lastRow: run.lastRow, ...frameStats(run.stamps) };
}

function podCount() {
  return kubectl(["-n", NAMESPACE, "get", "pods", "-o", "name"]).split("\n").filter(Boolean).length;
}

/** Tops the namespace up to `n` generated pods, 500 per kubectl call, 8 calls at a time. */
async function ensurePods(n) {
  try {
    kubectl(["create", "namespace", NAMESPACE]);
  } catch {
    // already there
  }
  let have = podCount();
  if (have > n) {
    // Left over from a bigger run: start this count from nothing.
    kubectl(["-n", NAMESPACE, "delete", "pods", "-l", "kubebay.dev/perf=true", "--wait=false"]);
    for (let i = 0; (have = podCount()) > 0; i++) {
      if (i === 120) throw new Error(`${have} pods still in ${NAMESPACE} a minute after deleting them`);
      await sleep(500);
    }
  }
  const chunks = [];
  for (let start = have; start < n; start += 500) chunks.push([start, Math.min(500, n - start)]);
  const create = ([start, count]) =>
    new Promise((resolve, reject) => {
      const p = spawn("kubectl", ["--kubeconfig", opts.kubeconfig, "--context", opts.context, "create", "-f", "-", "-o", "name"], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`kubectl create: ${err}`))));
      p.stdin.end(JSON.stringify(podsList(NAMESPACE, start, count)));
    });
  for (let i = 0; i < chunks.length; i += 8) await Promise.all(chunks.slice(i, i + 8).map(create));
  const now = podCount();
  if (now !== n) throw new Error(`wanted ${n} pods in ${NAMESPACE}, have ${now}`);
}

/**
 * Subscribes to every pod in the cluster the way the Pods page does and waits
 * for the snapshot. `count` is how many of the generated pods it delivered.
 */
async function watch(pods, mode) {
  const engine = await startEngine();
  await connect(engine);
  const ws = new WebSocket(`ws://127.0.0.1:${engine.port}/ws`, [`kubebay.token.${TOKEN}`]);
  ws.binaryType = "arraybuffer";
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("websocket failed to open"));
  });
  const keys = new Set();
  const synced = new Promise((resolve, reject) => {
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        const f = JSON.parse(ev.data);
        if (f.id !== "perf") return;
        if (f.type === "sync") resolve();
        if (f.type === "error") reject(new Error(f.message));
        return;
      }
      const f = decode(new Uint8Array(ev.data));
      if (f.id !== "perf") return;
      if (f.type === "begin") keys.clear();
      for (const op of f.ops ?? []) {
        if (op.op === "delete") keys.delete(op.key);
        else keys.add(op.key);
      }
    };
  });
  const t0 = performance.now();
  ws.send(JSON.stringify({ type: "sub", id: "perf", cluster: opts.context, gvr: "v1/pods", mode }));
  // An unref'd timer: a pending one would keep Node running for 5 minutes after the last watch.
  const timeout = sleep(300_000, undefined, { ref: false }).then(() => Promise.reject(new Error(`no sync for ${pods} pods in 5 min`)));
  await Promise.race([synced, timeout]);
  const syncMs = round(performance.now() - t0);
  await sleep(opts.settleMs / 2);
  const rss = await sampleRss(engine.proc.pid);
  const count = [...keys].filter((k) => k.startsWith(`${NAMESPACE}/`)).length;
  ws.close();
  await engine.stop();
  return { pods, mode, count, syncMs, rssMB: rss };
}

const kubernetes = JSON.parse(kubectl(["version", "-o", "json"])).serverVersion?.gitVersion;
const commit = process.env.GITHUB_SHA?.slice(0, 7) ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
const results = {
  date: new Date().toISOString(),
  commit,
  kubernetes,
  runner: `${platform()}, ${cpus().length} CPUs, ${Math.round(totalmem() / 2 ** 30)} GB`,
  settleSeconds: opts.settleMs / 1000,
};

const browser = await chromium.launch(opts.chromium ? { executablePath: opts.chromium } : {});
try {
  console.log("cold start…");
  results.coldStart = await coldStart(browser);
  console.log(JSON.stringify(results.coldStart));
  console.log("idle…");
  results.idle = await idle(browser);
  console.log(JSON.stringify(results.idle));
  console.log("idle, three clusters…");
  results.idle3 = await idle(browser, 3);
  console.log(JSON.stringify(results.idle3));
  console.log("watch event to painted row…");
  results.paint = await paint(browser);
  console.log(JSON.stringify(results.paint));
  console.log(`scrolling ${opts.scrollRows} rows…`);
  results.scroll = await scroll(browser, opts.scrollRows);
  console.log(JSON.stringify(results.scroll));
  results.watch = [];
  for (const n of [...opts.pods].sort((a, b) => a - b)) {
    console.log(`creating ${n} pods…`);
    await ensurePods(n);
    for (const mode of ["metadata", "full"]) {
      const w = await watch(n, mode);
      console.log(JSON.stringify(w));
      results.watch.push(w);
    }
  }
} finally {
  await browser.close();
}
writeFileSync(opts.out, JSON.stringify(results, null, 2) + "\n");
console.log(`wrote ${opts.out}`);
