// Pure parts of the MCP benchmark harness: scenario loading, the run loop, the
// result shape. No network and no cluster here; the client is injected.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

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

export function checkKubeconfigArg(path) {
  if (!path) throw new Error("--kubeconfig is required: pass the dedicated kind cluster's kubeconfig");
  const expanded = path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
  if (resolve(expanded) === join(homedir(), ".kube", "config")) throw new Error("refusing the default kubeconfig (~/.kube/config); use a dedicated kind kubeconfig");
  return path;
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

/** Checks against a server started read-only: the write tools are absent and refused. */
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
  await timed("readonly-propose-refused", async (count) => {
    count();
    const r = await client.callTool("propose_change", { cluster: ctx.cluster, kind: "deployments", namespace: ctx.namespace ?? "default", name: "x", patch: {}, reason: "bench" });
    const refused = r.isError && /read-only/i.test(r.text);
    return { pass: refused, error: refused ? "" : `propose_change was not refused: ${r.text}` };
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
