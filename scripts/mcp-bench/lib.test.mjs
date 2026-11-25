// Offline tests for the MCP benchmark harness: a fake MCP client, no network, no cluster.
// Run: node --test scripts/mcp-bench/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { loadScenarios, assertKindClusters, parseClusters, checkKubeconfigArg, runScenario, runReadOnlyChecks, runBench, redact } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));

function fakeClient({ tools = [], answers = {}, delayMs = 0, hang = false } = {}) {
  const calls = [];
  return {
    calls,
    async listTools() { return tools.map((name) => ({ name })); },
    async callTool(name, args) {
      calls.push({ name, args });
      if (hang) return new Promise(() => {});
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const a = answers[name];
      if (a instanceof Error) throw a;
      return a ?? { isError: false, text: "" };
    },
  };
}

const scenario = {
  id: "crash-loop",
  title: "A pod crash-loops",
  fault: "A pod whose command exits 1.",
  steps: [
    { tool: "list_resources", args: { cluster: "{cluster}", kind: "pods", namespace: "{namespace}" } },
    { tool: "list_events", args: { cluster: "{cluster}", namespace: "{namespace}" } },
  ],
  expect: { all: ["CrashLoopBackOff"], none: ["Secret value"] },
};
const ctx = { cluster: "kind-bench", namespace: "bench-crash-loop" };

test("shipped scenarios are valid, unique, in our own words", () => {
  const list = loadScenarios(join(here, "scenarios"));
  assert.ok(list.length >= 10);
  assert.equal(new Set(list.map((s) => s.id)).size, list.length);
  for (const s of list) {
    assert.ok(s.id && s.title && s.fault && s.steps.length && s.expect.all.length, s.id);
    for (const p of [...s.expect.all, ...(s.expect.none ?? [])]) new RegExp(p, "i");
  }
  // Written in our own words: no links or product names ride along in a scenario file.
  for (const f of readdirSync(join(here, "scenarios"))) assert.doesNotMatch(readFileSync(join(here, "scenarios", f), "utf8"), /https?:|github\.com/i, f);
});

test("loadScenarios rejects a scenario with no expectation", () => {
  assert.throws(() => loadScenarios(join(here, "testdata-bad")), /expect/);
});

test("a scenario passes when every pattern shows up in the tool output", async () => {
  const c = fakeClient({ answers: { list_resources: { isError: false, text: "web-1 CrashLoopBackOff 7" } } });
  let t = 0;
  const r = await runScenario(c, scenario, ctx, { timeoutMs: 1000, now: () => (t += 50) });
  assert.equal(r.pass, true);
  assert.equal(r.toolCalls, 2);
  assert.equal(r.durationMs, 50);
  assert.equal(r.error, "");
  assert.deepEqual(c.calls[0].args, { cluster: "kind-bench", kind: "pods", namespace: "bench-crash-loop" });
});

test("a scenario fails when evidence is missing or forbidden text appears", async () => {
  const missing = await runScenario(fakeClient(), scenario, ctx, { timeoutMs: 1000 });
  assert.equal(missing.pass, false);
  assert.match(missing.error, /CrashLoopBackOff/);
  const forbidden = await runScenario(fakeClient({ answers: { list_events: { isError: false, text: "CrashLoopBackOff Secret value" } } }), scenario, ctx, { timeoutMs: 1000 });
  assert.equal(forbidden.pass, false);
  assert.match(forbidden.error, /forbidden/);
});

test("a tool error, a thrown error and a timeout each fail the scenario and carry on", async () => {
  const toolErr = await runScenario(fakeClient({ answers: { list_resources: { isError: true, text: "cluster unreachable" } } }), scenario, ctx, { timeoutMs: 1000 });
  assert.equal(toolErr.pass, false);
  assert.match(toolErr.error, /cluster unreachable/);
  const thrown = await runScenario(fakeClient({ answers: { list_resources: new Error("socket hang up") } }), scenario, ctx, { timeoutMs: 1000 });
  assert.match(thrown.error, /socket hang up/);
  const slow = await runScenario(fakeClient({ hang: true }), scenario, ctx, { timeoutMs: 20 });
  assert.equal(slow.pass, false);
  assert.match(slow.error, /timed out/);
});

test("read-only checks: no write tool listed and propose_change refused", async () => {
  const good = fakeClient({ tools: ["list_clusters", "get_logs"], answers: { propose_change: { isError: true, text: "kubebay MCP is read-only: this tool can change cluster state and is turned off in Kubebay" } } });
  const rs = await runReadOnlyChecks(good, ctx);
  assert.deepEqual(rs.map((r) => r.id), ["readonly-no-write-tools-listed", "readonly-propose-refused"]);
  assert.ok(rs.every((r) => r.pass));
  const bad = fakeClient({ tools: ["list_clusters", "propose_change"], answers: { propose_change: { isError: false, text: "proposal created" } } });
  const rb = await runReadOnlyChecks(bad, ctx);
  assert.ok(rb.every((r) => !r.pass));
});

test("assertKindClusters refuses any cluster that is not a kind-* one", () => {
  assertKindClusters([{ id: "kind-a" }, { id: "kind-b" }]);
  assert.throws(() => assertKindClusters([{ id: "kind-a" }, { id: "prod-eks" }]), /prod-eks/);
  assert.throws(() => assertKindClusters([]), /no clusters/);
});

test("the default kubeconfig is refused and an explicit path is required", () => {
  assert.throws(() => checkKubeconfigArg(undefined), /--kubeconfig/);
  assert.throws(() => checkKubeconfigArg(join(homedir(), ".kube", "config")), /default/);
  assert.throws(() => checkKubeconfigArg("~/.kube/config"), /default/);
  assert.equal(checkKubeconfigArg("/tmp/kind-bench.kubeconfig"), "/tmp/kind-bench.kubeconfig");
});

test("runBench records every scenario, writes the shape, and never contains the token", async () => {
  const token = "s3cret-token-value-1234567890";
  const c = fakeClient({
    tools: ["list_clusters"],
    answers: {
      list_clusters: { isError: false, text: "kind-bench reachable" },
      list_resources: { isError: false, text: "CrashLoopBackOff" },
      list_events: new Error(`fetch failed: Authorization: Bearer ${token}`),
    },
  });
  const two = [scenario, { ...scenario, id: "second", steps: [scenario.steps[0]] }];
  const out = await runBench({ client: c, scenarios: two, clusters: [{ id: "kind-bench" }], server: "kubebay test", secrets: [token], timeoutMs: 500, readOnly: false });
  const json = JSON.stringify(out);
  assert.doesNotMatch(json, new RegExp(token));
  assert.equal(out.baselineMeasured, false);
  assert.deepEqual(out.scenarios.map((s) => [s.id, s.pass]), [["crash-loop", false], ["second", true]]);
  assert.equal(out.summary.passed, 1);
  assert.equal(out.summary.failed, 1);
  assert.equal(typeof out.summary.totalMs, "number");
  assert.equal(out.cluster, "kind-bench");
  assert.ok(out.startedAt);
});

test("redact removes every secret and tolerates empty ones", () => {
  assert.equal(redact("a tok b tok", ["tok", ""]), "a [redacted] b [redacted]");
});

test("parseClusters reads list_clusters' JSON and tolerates junk", () => {
  assert.deepEqual(parseClusters(JSON.stringify({ clusters: [{ id: "kind-a", status: "reachable" }] })), [{ id: "kind-a" }]);
  assert.deepEqual(parseClusters("not json"), []);
  assert.deepEqual(parseClusters("{}"), []);
});
