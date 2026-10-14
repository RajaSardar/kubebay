#!/usr/bin/env node
// KB-02 steps 2 and 3: measure the engine binary against a real cluster and
// write perf.json. Linux only: memory and CPU come from /proc.
//
//   node perf/harness.mjs --engine engine/bin/kubebay --kubeconfig KUBECONFIG --context CONTEXT \
//     [--pods 1000,10000] [--runs 5] [--settle 20] [--out perf/perf.json] [--chromium PATH]
//
// What each number means, and what it leaves out, is in docs/PERFORMANCE.md.

import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { cpus, platform, tmpdir, totalmem } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { decode } from "@msgpack/msgpack";
import { chromium } from "playwright-core";
import { cpuTicks, median, podsList, rssMB } from "./lib.mjs";

const TOKEN = "kubebay-perf";
const NAMESPACE = "kubebay-perf";

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
async function startEngine() {
  const home = mkdtempSync(join(tmpdir(), "kubebay-perf-"));
  const port = await freePort();
  const t0 = performance.now();
  const proc = spawn(
    opts.engine,
    ["--addr", `127.0.0.1:${port}`, "--no-open", "--kubeconfig", opts.kubeconfig, "--token-file", join(home, "session-token")],
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

async function connect(engine) {
  const r = await fetch(`${engine.base}/api/clusters/${encodeURIComponent(opts.context)}/connect`, {
    method: "POST",
    headers: { "X-Kubebay-Token": TOKEN },
  });
  if (!r.ok) throw new Error(`connect ${opts.context}: ${r.status} ${await r.text()}`);
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

/** One cluster connected, the app open on its overview, nobody touching it. */
async function idle(browser) {
  const engine = await startEngine();
  await connect(engine);
  const { ctx, page } = await newPage(browser, engine.base, opts.context);
  await page.goto(`${engine.base}/workloads-overview`);
  await sleep(opts.settleMs);
  const result = { rssMB: await sampleRss(engine.proc.pid), cpuPercent: await cpuPercent(engine.proc.pid, 10) };
  await ctx.close();
  await engine.stop();
  return result;
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
