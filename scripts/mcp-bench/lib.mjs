// Pure parts of the MCP benchmark harness: scenario loading, the run loop, the
// result shape. No network and no cluster here; the client is injected.
import { mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const WRITE_TOOLS = ["propose_change", "get_proposal_status"];

export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets) if (s) out = out.split(s).join("[redacted]");
  return out;
}

export function loadScenarios(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const out = [];
  for (const f of files) {
    const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const k of ["id", "title", "fault"]) if (!s[k]) throw new Error(`${f}: missing ${k}`);
    if (!Array.isArray(s.steps) || s.steps.length === 0) throw new Error(`${f}: needs steps`);
    if (!s.expect || !Array.isArray(s.expect.all) || s.expect.all.length === 0) throw new Error(`${f}: needs expect.all`);
    out.push(s);
  }
  return out;
}

export function parseClusters(text) {
  try {
    const rows = JSON.parse(text).clusters;
    return Array.isArray(rows) ? rows.map((c) => ({ id: String(c.id) })) : [];
  } catch {
    return [];
  }
}

/** The run is only ever allowed against disposable kind clusters. */
export function assertKindClusters(clusters) {
  if (!clusters || clusters.length === 0) throw new Error("the server lists no clusters; allow a kind cluster in Kubebay's MCP settings first");
  const bad = clusters.filter((c) => !String(c.id).startsWith("kind-"));
  if (bad.length) throw new Error(`refusing to run: cluster(s) ${bad.map((c) => c.id).join(", ")} are not kind-* clusters; allow only the dedicated kind cluster for MCP`);
}

function realOrResolved(p) {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/**
 * The kubeconfig is the one thing that decides which clusters a run can touch,
 * so it must be an explicit file named kind-* (the allowlist), and never the
 * default ~/.kube/config, whether named directly or through a symlink.
 */
export function checkKubeconfigArg(path, { home = homedir() } = {}) {
  if (!path) throw new Error("--kubeconfig is required: pass the dedicated kind cluster's kubeconfig");
  const expanded = path.startsWith("~/") ? join(home, path.slice(2)) : path;
  const def = join(home, ".kube", "config");
  if (resolve(expanded) === def || realOrResolved(expanded) === realOrResolved(def)) throw new Error("refusing the default kubeconfig (~/.kube/config); use a dedicated kind kubeconfig");
  if (!/^kind-[^/]+$/.test(basename(resolve(expanded)))) throw new Error(`refusing ${path}: the kubeconfig file must be named kind-* (for example kind-bench.kubeconfig)`);
  return path;
}

/** Context names in a kubeconfig's YAML text; just enough parsing, no YAML library. */
export function kubeconfigContexts(yaml) {
  const out = [];
  let inContexts = false;
  for (const line of String(yaml).split("\n")) {
    if (/^[A-Za-z]/.test(line)) inContexts = /^contexts:\s*$/.test(line);
    else if (inContexts) {
      const m = line.match(/^\s*(?:-\s+)?name:\s*["']?([^"'\s#]+)/);
      if (m) out.push(m[1]);
    }
  }
  return out;
}

export function assertKindContexts(contexts) {
  if (!contexts || contexts.length === 0) throw new Error("the kubeconfig has no contexts");
  const bad = contexts.filter((c) => !c.startsWith("kind-"));
  if (bad.length) throw new Error(`refusing to run: kubeconfig context(s) ${bad.join(", ")} are not kind-* contexts`);
}

/** What the server lists must come from the kubeconfig the run was given. */
export function assertClustersInKubeconfig(clusters, contexts) {
  const stray = clusters.filter((c) => !contexts.includes(c.id));
  if (stray.length) throw new Error(`refusing to run: the server lists ${stray.map((c) => c.id).join(", ")}, which is not in the given kubeconfig; point the engine at that kubeconfig or let the harness start it with --engine`);
}

/** How to start the engine the harness drives, with the given kubeconfig and nothing else. */
export function engineLaunch({ engine, kubeconfig, port, home, readOnly = false }) {
  const args = ["--kubeconfig", kubeconfig, "--addr", `127.0.0.1:${port}`, "--no-open"];
  if (readOnly) args.push("--mcp-read-only");
  return {
    command: engine,
    args,
    // KUBEBAY_KUBECONFIG makes it the only kubeconfig the engine loads; HOME is a
    // temporary directory so settings and the MCP connection file stay out of the real one.
    env: { ...process.env, HOME: home, KUBECONFIG: kubeconfig, KUBEBAY_KUBECONFIG: kubeconfig },
  };
}

/** Turns MCP on (reads only) for the given contexts in a throwaway home. */
export function seedSettings(home, contexts) {
  mkdirSync(join(home, ".kubebay"), { recursive: true });
  writeFileSync(join(home, ".kubebay", "settings.json"), JSON.stringify({ mcp: { enabled: true, clusters: Object.fromEntries(contexts.map((c) => [c, []])) } }, null, 2));
}

function fill(value, ctx) {
  if (typeof value === "string") return value.replace(/\{(cluster|namespace)\}/g, (_, k) => ctx[k]);
  if (Array.isArray(value)) return value.map((v) => fill(v, ctx));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, ctx)]));
  return value;
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Runs one scenario's tool calls and checks the evidence patterns on what came back. */
export async function runScenario(client, scenario, ctx, { timeoutMs = 60000, now = Date.now, secrets = [] } = {}) {
  const start = now();
  let toolCalls = 0;
  let error = "";
  let pass = false;
  try {
    const texts = [];
    await withTimeout((async () => {
      for (const step of scenario.steps) {
        toolCalls++;
        const r = await client.callTool(step.tool, fill(step.args ?? {}, ctx));
        if (r.isError) throw new Error(`${step.tool} returned an error: ${r.text}`);
        texts.push(r.text);
      }
    })(), timeoutMs, scenario.id);
    const all = texts.join("\n");
    const missing = scenario.expect.all.filter((p) => !new RegExp(p, "i").test(all));
    const forbidden = (scenario.expect.none ?? []).filter((p) => new RegExp(p, "i").test(all));
    if (missing.length) error = `missing evidence: ${missing.join(", ")}`;
    else if (forbidden.length) error = `forbidden text present: ${forbidden.join(", ")}`;
    else pass = true;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  return { id: scenario.id, pass, durationMs: now() - start, toolCalls, error: redact(error, secrets) };
}

/**
 * Checks a server started read-only by listing its tools only. It never calls a
 * write tool: against an engine that is not read-only that would propose a change.
 */
export async function runReadOnlyChecks(client, ctx, { now = Date.now, secrets = [] } = {}) {
  const results = [];
  const timed = async (id, fn) => {
    const start = now();
    let pass = false;
    let error = "";
    let toolCalls = 0;
    try {
      const r = await fn(() => { toolCalls++; });
      pass = r.pass;
      error = r.error ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    results.push({ id, pass, durationMs: now() - start, toolCalls, error: redact(error, secrets) });
  };
  await timed("readonly-no-write-tools-listed", async () => {
    const names = (await client.listTools()).map((t) => t.name);
    const leaked = names.filter((n) => WRITE_TOOLS.includes(n));
    return { pass: leaked.length === 0, error: leaked.length ? `write tools listed: ${leaked.join(", ")}` : "" };
  });
  return results;
}

export async function runBench({ client, scenarios, clusters, server, secrets = [], timeoutMs, readOnly = false, now = Date.now }) {
  const startedAt = new Date().toISOString();
  const t0 = now();
  const cluster = clusters[0].id;
  const results = [];
  for (const s of scenarios) {
    results.push(await runScenario(client, s, { cluster, namespace: `bench-${s.id}` }, { timeoutMs, now, secrets }));
  }
  if (readOnly) results.push(...(await runReadOnlyChecks(client, { cluster }, { now, secrets })));
  const passed = results.filter((r) => r.pass).length;
  return {
    startedAt,
    server: redact(server, secrets),
    cluster,
    scenarios: results,
    summary: { passed, failed: results.length - passed, totalMs: now() - t0 },
    // No baseline has been measured; this stays false until a real run is recorded in the docs.
    baselineMeasured: false,
  };
}

export function writeResult(path, result) {
  writeFileSync(path, JSON.stringify(result, null, 2) + "\n");
}
