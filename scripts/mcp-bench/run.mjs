#!/usr/bin/env node
// Drives an already-running Kubebay MCP server through the scenario list in
// ./scenarios and writes per-scenario pass/fail and time to a JSON file.
// It starts no cluster and injects no faults; see README.md. Never run it
// against anything but a dedicated kind cluster.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { httpClient } from "./client.mjs";
import { assertKindClusters, parseClusters, checkKubeconfigArg, loadScenarios, runBench, writeResult } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { values: v } = parseArgs({
  options: {
    url: { type: "string" },
    "token-file": { type: "string" },
    kubeconfig: { type: "string" },
    out: { type: "string", default: "mcp-bench-result.json" },
    scenarios: { type: "string", default: join(here, "scenarios") },
    only: { type: "string" },
    timeout: { type: "string", default: "60000" },
    "read-only": { type: "boolean", default: false },
  },
});

try {
  if (!v.url || !v["token-file"]) throw new Error("--url and --token-file are required (the URL and token from Kubebay's MCP connection file)");
  checkKubeconfigArg(v.kubeconfig);
  const token = JSON.parse(readFileSync(v["token-file"], "utf8")).token;
  if (!token) throw new Error("no token in the token file");
  const client = httpClient({ url: v.url, token });
  const first = await client.callTool("list_clusters", {});
  const clusters = parseClusters(first.text);
  assertKindClusters(clusters);
  let scenarios = loadScenarios(v.scenarios);
  if (v.only) scenarios = scenarios.filter((s) => v.only.split(",").includes(s.id));
  const result = await runBench({ client, scenarios, clusters, server: v.url, secrets: [token], timeoutMs: Number(v.timeout), readOnly: v["read-only"] });
  writeResult(v.out, result);
  console.log(`${result.summary.passed} passed, ${result.summary.failed} failed in ${result.summary.totalMs} ms; wrote ${v.out}`);
  process.exit(result.summary.failed ? 1 : 0);
} catch (e) {
  console.error("mcp-bench:", e instanceof Error ? e.message : e);
  process.exit(2);
}
