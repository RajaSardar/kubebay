#!/usr/bin/env node
// Checks that an engine binary serves the local shell, the terminal on your
// own machine that the desktop app turns on with --local-shell. Only a binary
// built with -tags localshell has it; release.yml once built the desktop
// app's engine without the tag, so every released app said "local shell is
// not built into this binary".
//
//   node scripts/local-shell-check.mjs --engine desktop/src-tauri/binaries/kubebay-engine-<triple> [--expect-unsupported]
//
// It starts the engine as the desktop app does (--local-shell, a loopback
// address, a token file) with its own HOME and no kubeconfig, reads
// /api/settings, and exits 0 only if localShell.available is true.
//
// Windows has no local shell (ConPTY has no process-group teardown), so there
// --expect-unsupported passes on the platform's own reason instead, which only
// a binary built with the tag gives.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const UNSUPPORTED = "not supported on this platform";

/**
 * Whether /api/settings says a local shell would start, and why not if it
 * wouldn't. With expectUnsupported (Windows), passes on the platform's reason.
 */
export function verdict(settings, { expectUnsupported = false } = {}) {
  const ls = settings?.localShell;
  if (!ls) return { ok: false, message: "the engine's settings have no localShell status" };
  if (expectUnsupported) {
    if (!ls.available && (ls.reason ?? "").includes(UNSUPPORTED)) {
      return { ok: true, message: "local shell built in, and unsupported on this platform as expected" };
    }
    return { ok: false, message: `expected "${UNSUPPORTED}", got ${ls.available ? "a local shell" : `"${ls.reason || "no reason"}"`}` };
  }
  if (ls.available) return { ok: true, message: `local shell available${ls.shell ? ` (${ls.shell})` : ""}` };
  return { ok: false, message: `local shell unavailable: ${ls.reason || "no reason given"}` };
}

async function freePort() {
  const srv = createServer();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main(argv) {
  const i = argv.indexOf("--engine");
  const engine = i >= 0 ? argv[i + 1] : undefined;
  if (!engine) throw new Error("--engine <path> is required");
  const home = mkdtempSync(join(tmpdir(), "kubebay-shell-check-"));
  const tokenFile = join(home, "session-token");
  const addr = `127.0.0.1:${await freePort()}`;
  const proc = spawn(engine, ["--no-open", "--addr", addr, "--token-file", tokenFile, "--local-shell"], {
    env: { ...process.env, HOME: home, USERPROFILE: home, KUBECONFIG: join(home, "no-kubeconfig") },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  proc.stderr.on("data", (d) => (stderr += d));
  try {
    let token = "";
    for (let n = 0; n < 60 && !token; n++) {
      if (proc.exitCode !== null) throw new Error(`the engine exited (${proc.exitCode}):\n${stderr}`);
      if (existsSync(tokenFile)) token = readFileSync(tokenFile, "utf8").trim();
      if (!token) await sleep(250);
    }
    if (!token) throw new Error(`the engine published no session token:\n${stderr}`);
    let settings;
    for (let n = 0; n < 40 && !settings; n++) {
      try {
        const res = await fetch(`http://${addr}/api/settings`, { headers: { "X-Kubebay-Token": token } });
        if (res.ok) settings = await res.json();
      } catch {
        // not listening yet
      }
      if (!settings) await sleep(250);
    }
    if (!settings) throw new Error(`no answer from http://${addr}/api/settings:\n${stderr}`);
    return verdict(settings, { expectUnsupported: argv.includes("--expect-unsupported") });
  } finally {
    proc.kill();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2))
    .then((v) => {
      console.log(v.message);
      process.exit(v.ok ? 0 : 1);
    })
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}
