// Offline tests for the MCP benchmark harness: a fake MCP client, no network, no cluster.
// Run: node --test scripts/mcp-bench/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { loadScenarios, assertKindClusters, parseClusters, checkKubeconfigArg, kubeconfigContexts, assertKindContexts, assertClustersInKubeconfig, engineLaunch, seedSettings, runScenario, runReadOnlyChecks, runBench, redact } from "./lib.mjs";

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

test("read-only check only lists tools: it never calls a write tool", async () => {
  const good = fakeClient({ tools: ["list_clusters", "get_logs"] });
  const rs = await runReadOnlyChecks(good, ctx);
  assert.deepEqual(rs.map((r) => r.id), ["readonly-no-write-tools-listed"]);
  assert.ok(rs.every((r) => r.pass));
  assert.deepEqual(good.calls, []);
  // An engine that is not read-only lists propose_change: the check fails, and still calls nothing.
  const bad = fakeClient({ tools: ["list_clusters", "propose_change"], answers: { propose_change: { isError: false, text: "proposal created" } } });
  const rb = await runReadOnlyChecks(bad, ctx);
  assert.ok(rb.every((r) => !r.pass));
  assert.deepEqual(bad.calls, []);
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

test("only kind-* kubeconfig files are allowed, and a symlink to the default is refused", () => {
  assert.throws(() => checkKubeconfigArg("/tmp/prod.kubeconfig"), /kind-\*/);
  assert.throws(() => checkKubeconfigArg("/tmp/config"), /kind-\*/);
  assert.throws(() => checkKubeconfigArg("/tmp/kind-x/../prod"), /kind-\*/);
  const dir = mkdtempSync(join(tmpdir(), "bench-"));
  const fake = join(dir, "home");
  mkdirSync(join(fake, ".kube"), { recursive: true });
  writeFileSync(join(fake, ".kube", "config"), "apiVersion: v1\n");
  symlinkSync(join(fake, ".kube", "config"), join(dir, "kind-link"));
  assert.throws(() => checkKubeconfigArg(join(dir, "kind-link"), { home: fake }), /default/);
});

test("kubeconfigContexts lists context names, and every one must be kind-*", () => {
  const yaml = "apiVersion: v1\nclusters:\n- name: kind-bench\n  cluster: {server: 'https://127.0.0.1:1'}\ncontexts:\n- context: {cluster: kind-bench, user: kind-bench}\n  name: kind-bench\n- name: kind-two\n  context: {cluster: kind-bench, user: x}\ncurrent-context: kind-bench\n";
  assert.deepEqual(kubeconfigContexts(yaml), ["kind-bench", "kind-two"]);
  assertKindContexts(["kind-bench"]);
  assert.throws(() => assertKindContexts(["kind-bench", "prod-eks"]), /prod-eks/);
  assert.throws(() => assertKindContexts([]), /no contexts/);
});

test("clusters the server lists must come from the given kubeconfig", () => {
  assertClustersInKubeconfig([{ id: "kind-bench" }], ["kind-bench", "kind-two"]);
  assert.throws(() => assertClustersInKubeconfig([{ id: "kind-other" }], ["kind-bench"]), /kind-other/);
});

test("the engine the harness starts gets the kubeconfig, an isolated home and read-only on request", () => {
  const l = engineLaunch({ engine: "/bin/kubebay", kubeconfig: "/tmp/kind-bench.kubeconfig", port: 19898, home: "/tmp/h", readOnly: true });
  assert.equal(l.command, "/bin/kubebay");
  assert.deepEqual(l.args.slice(0, 2), ["--kubeconfig", "/tmp/kind-bench.kubeconfig"]);
  assert.ok(l.args.includes("--no-open") && l.args.includes("--mcp-read-only"));
  assert.ok(l.args.includes("127.0.0.1:19898"));
  assert.equal(l.env.KUBEBAY_KUBECONFIG, "/tmp/kind-bench.kubeconfig");
  assert.equal(l.env.HOME, "/tmp/h");
  assert.equal(l.env.KUBECONFIG, "/tmp/kind-bench.kubeconfig");
  assert.equal(engineLaunch({ engine: "/bin/kubebay", kubeconfig: "/tmp/kind-b", port: 1, home: "/tmp/h" }).args.includes("--mcp-read-only"), false);
});

test("seedSettings turns MCP on for exactly the kubeconfig's contexts, read-only writes off", () => {
  const home = mkdtempSync(join(tmpdir(), "bench-home-"));
  seedSettings(home, ["kind-bench"]);
  const saved = JSON.parse(readFileSync(join(home, ".kubebay", "settings.json"), "utf8"));
  assert.deepEqual(saved.mcp, { enabled: true, clusters: { "kind-bench": [] } });
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
