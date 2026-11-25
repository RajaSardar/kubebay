# MCP benchmark harness

A runnable script that drives Kubebay's MCP server through a list of
fault scenarios and records, per scenario, pass or fail and the time taken,
in a JSON file. It is how we will measure whether the tools give an assistant
enough evidence to find a fault.

**Baseline numbers have not been measured yet.** Nothing in this folder has
been run against a cluster. The unit tests use a fake MCP client and need no
network and no cluster. Every result file says `"baselineMeasured": false`
until someone runs it against a dedicated kind cluster and records the
numbers in the docs.

## What it does and does not do

- It drives a Kubebay engine with MCP turned on, either one you already run
  (`--url` and `--token-file`) or one it starts itself (`--engine <binary>`).
  It does not start a cluster, Docker, OrbStack or the desktop app, and it
  does not create the faults. You create each scenario's fault yourself (each
  scenario's `fault` field says what to create, in namespace
  `bench-<scenario id>`).
- It calls the scenario's tools (`get_cluster_health`, `list_resources`,
  `list_events`, ...) and checks that the output holds the evidence the
  scenario expects (`expect.all`, regular expressions) and nothing it must not
  (`expect.none`). That measures the tools, not a model.
- Safety. `--kubeconfig` is required, must be an explicit file named `kind-*`
  (for example `kind-bench.kubeconfig`), and must not be, or link to, the
  default `~/.kube/config`; every context in it must be `kind-*` too. With
  `--engine` the harness starts the engine with that kubeconfig as the only
  one it loads (`--kubeconfig` and `KUBEBAY_KUBECONFIG`) and a temporary home,
  so your real settings and MCP token are not touched. With `--url` it cannot
  change what the running engine loads, so it refuses to run unless every
  cluster the server lists is a context of the given kubeconfig. The token is
  read from the connection file, sent as a Bearer header, and removed from
  anything written to the result.
- `--read-only` checks only the tool listing: it fails if a write tool is
  listed, and it never calls one, so it is safe against an engine that might
  not be read-only.

## Run

```
node scripts/mcp-bench/run.mjs \
  --engine /path/to/kubebay-engine \
  --kubeconfig /path/to/kind-bench.kubeconfig \
  --out /tmp/mcp-bench-result.json
```

Or against an engine you already run (allow only the dedicated kind cluster in
Kubebay's Settings, MCP):

```
node scripts/mcp-bench/run.mjs \
  --url http://127.0.0.1:9898/mcp \
  --token-file ~/.kubebay/mcp.json \
  --kubeconfig /path/to/kind-bench.kubeconfig
```

Options: `--only crash-loop,oom-kill` runs some scenarios, `--timeout 60000` is
per scenario in milliseconds, `--port 19898` is the port of the engine it
starts, `--scenarios <dir>` uses another list, and `--read-only` adds the
`readonly-no-write-tools-listed` check for an engine started with
`--mcp-read-only`. The exit code is 0 when everything passed, 1 when
something failed, 2 when the run was refused or broke.

The `--engine` path (starting the engine, the temporary-home settings and the
connection-file wait) has not been run against a real engine; only the
argument building is unit tested.

## Result

```json
{
  "startedAt": "2026-01-01T00:00:00.000Z",
  "server": "http://127.0.0.1:9898/mcp",
  "cluster": "kind-bench",
  "scenarios": [{ "id": "crash-loop", "pass": true, "durationMs": 812, "toolCalls": 3, "error": "" }],
  "summary": { "passed": 1, "failed": 0, "totalMs": 812 },
  "baselineMeasured": false
}
```

A scenario that times out, errors or lacks the evidence is recorded with
`pass: false` and an `error`, and the run carries on.

## Scenarios

`scenarios/*.json`: crash loop, bad image, OOM kill, unschedulable pod,
failing probe, missing ConfigMap, Service selector matching nothing, Ingress
without a backend, stuck volume claim, workload scaled to zero. Each has an
`id`, `title`, `fault`, `steps` (tool calls, with `{cluster}` and `{namespace}`
filled in) and `expect`.

## Tests

```
node --test scripts/mcp-bench/*.test.mjs
```
