#!/usr/bin/env node
// Drives an already-running Kubebay MCP server through the scenario list in
// ./scenarios and writes per-scenario pass/fail and time to a JSON file.
// It starts no cluster and injects no faults; see README.md. Never run it
// against anything but a dedicated kind cluster.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { httpClient } from "./client.mjs";
import { assertClustersInKubeconfig, assertKindClusters, assertKindContexts, checkKubeconfigArg, engineLaunch, kubeconfigContexts, loadScenarios, parseClusters, runBench, seedSettings, writeResult } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values: v } = parseArgs({
  options: {
    url: { type: "string" },
    engine: { type: "string" },
    port: { type: "string", default: "19898" },
    "token-file": { type: "string" },
    kubeconfig: { type: "string" },
    out: { type: "string", default: "mcp-bench-result.json" },
    scenarios: { type: "string", default: join(here, "scenarios") },
    only: { type: "string" },
    timeout: { type: "string", default: "60000" },
    "read-only": { type: "boolean", default: false },
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child;
let tmpHome;
const stop = () => {
  if (child && !child.killed) child.kill("SIGTERM");
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
};

try {
  checkKubeconfigArg(v.kubeconfig);
  const contexts = kubeconfigContexts(readFileSync(v.kubeconfig, "utf8"));
  assertKindContexts(contexts);
  let url = v.url;
  let tokenFile = v["token-file"];
  if (v.engine) {
    // The harness starts the engine itself: the kubeconfig is passed to it, it is
    // the only one it loads, and its settings live in a throwaway home.
    tmpHome = mkdtempSync(join(tmpdir(), "kubebay-bench-"));
    seedSettings(tmpHome, contexts);
    const l = engineLaunch({ engine: v.engine, kubeconfig: v.kubeconfig, port: Number(v.port), home: tmpHome, readOnly: v["read-only"] });
    child = spawn(l.command, l.args, { env: l.env, stdio: "ignore" });
    url = `http://127.0.0.1:${v.port}/mcp`;
    tokenFile = join(tmpHome, ".kubebay", "mcp.json");
    for (let i = 0; i < 100 && !existsSync(tokenFile); i++) await sleep(200);
    if (!existsSync(tokenFile)) throw new Error("the engine did not write its MCP connection file in 20 s");
  } else if (!url || !tokenFile) {
    throw new Error("pass --engine <kubebay binary> to let the harness start the engine, or --url and --token-file for one that is already running");
  }
  const token = JSON.parse(readFileSync(tokenFile, "utf8")).token;
  if (!token) throw new Error("no token in the token file");
  const client = httpClient({ url, token });
  const first = await client.callTool("list_clusters", {});
  const clusters = parseClusters(first.text);
  assertKindClusters(clusters);
  assertClustersInKubeconfig(clusters, contexts);
  let scenarios = loadScenarios(v.scenarios);
  if (v.only) scenarios = scenarios.filter((s) => v.only.split(",").includes(s.id));
  const result = await runBench({ client, scenarios, clusters, server: url, secrets: [token], timeoutMs: Number(v.timeout), readOnly: v["read-only"] });
  writeResult(v.out, result);
  console.log(`${result.summary.passed} passed, ${result.summary.failed} failed in ${result.summary.totalMs} ms; wrote ${v.out}`);
  stop();
  process.exit(result.summary.failed ? 1 : 0);
} catch (e) {
  stop();
  console.error("mcp-bench:", e instanceof Error ? e.message : e);
  process.exit(2);
}
