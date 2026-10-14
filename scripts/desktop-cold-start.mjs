#!/usr/bin/env node
// KB-02 step 3: the desktop app's cold start, from launch to the shell's first
// painted frame. It uses the smoke run (KB-14): with KUBEBAY_SMOKE=1 the app
// exits 0 as soon as the page reports it has painted. Run it on the release
// build and record the result with the release:
//
//   node scripts/desktop-cold-start.mjs [/Applications/Kubebay.app/Contents/MacOS/Kubebay] [runs]
//
// Prints {"runs":[ms…],"medianMs":ms}. The first run starts from a cold disk
// cache, so the median is a warm start; the first run is reported too.

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

function smokeRun(app) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const p = spawn(app, [], { env: { ...process.env, KUBEBAY_SMOKE: "1" }, stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve(Math.round(performance.now() - t0)) : reject(new Error(`smoke run exited with ${code}`))));
  });
}

export async function measure(app, runs = 5) {
  const times = [];
  for (let i = 0; i < runs; i++) times.push(await smokeRun(app));
  const sorted = [...times].sort((a, b) => a - b);
  return { runs: times, medianMs: sorted[sorted.length >> 1] };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = process.argv[2] ?? "/Applications/Kubebay.app/Contents/MacOS/Kubebay";
  console.log(JSON.stringify(await measure(app, Number(process.argv[3] ?? 5))));
}
