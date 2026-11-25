# Design note: backlog 77, MCP read-only mode and benchmark harness

## Goal
(a) An owner switch that makes the MCP server read-only. When on, every tool
that can change cluster state or create a proposal (today `propose_change`) is
absent from `tools/list` and refuses on `tools/call` with a clear error.
Default stays as today (off). (b) A runnable, documented harness in
`scripts/mcp-bench` that drives our MCP server through a fault-injection
scenario list and records per-scenario pass/fail and time to JSON. No new MCP
tools.

## Data sources
- Tool registry: `engine/internal/mcp/tools.go` (`Registry`, `Tool`) and
  registrations in `engine/internal/mcp/kubetools/` (`list_clusters`,
  `list_resources`, `describe_resource`, `get_logs`, `list_events`,
  `get_manifest`, `get_cluster_health`, `propose_change`,
  `get_proposal_status`).
- MCP settings: `MCPSettings` in `engine/internal/httpapi` (settings file,
  `/api/mcp`), wired in `engine/cmd/kubebay/mcp.go` (`newMCP`).
- Shared-engine lock: `SettingsManager.SharedLocked` and `MCPBlockReason`.
- Helm values: `charts/values.yaml` plus templates (engine args/env).
- Benchmark input: a scenario list JSON (id, title, fault setup note, prompt,
  expected-evidence predicate) checked into `scripts/mcp-bench/scenarios/`,
  written by hand from the public benchmark's scenario names. Nothing is
  fetched at test time.

## Module layout
- `engine/internal/mcp/tools.go`: add `Access` (`AccessRead` | `AccessWrite`)
  to `Tool`, required at `Add` (panic on zero value so an unclassified tool
  cannot register). `Registry` gets `ReadOnly bool` (or a `Filter`), applied in
  `list()` and in the call path (`Get`).
- `engine/internal/mcp/kubetools/`: each registration sets `Access`;
  `propose_change` is `AccessWrite`; the rest `AccessRead`.
- `engine/internal/mcp/readonly_test.go` and
  `kubetools/classify_test.go`: guard test (see Test plan).
- `engine/cmd/kubebay/main.go` and `mcp.go`: flag `--mcp-read-only`, env
  `KUBEBAY_MCP_READ_ONLY`, resolution function `resolveMCPReadOnly(flag, env,
  settings, shared)` in a small pure file `mcpreadonly.go`.
- `engine/internal/httpapi` MCP settings: `ReadOnly bool` field
  (`json:"readOnly"`) on `MCPSettings`; `/api/mcp` GET reports
  `readOnly` and `readOnlyLocked` (reason string); PUT refuses to change it when
  locked.
- `charts/values.yaml` + engine deployment template: `mcp.readOnly: false`
  rendered as `--mcp-read-only` / `KUBEBAY_MCP_READ_ONLY`.
- `web/apps/shell`: Settings MCP section gets a "Read-only" switch from
  `@kubebay/ui` (Toggle/Switch), disabled with the lock reason on a shared
  engine; the existing `lib/` MCP types gain `readOnly`, `readOnlyLocked`.
- `scripts/mcp-bench/`: `run.mjs` (CLI), `lib.mjs` (pure: scenario loading,
  timing, result shaping, JSON writer), `client.mjs` (minimal MCP client over
  stdio or HTTP, injectable transport), `lib.test.mjs` (fake client), 
  `scenarios/*.json`, `README.md`.
- Docs: `website/src/content/docs/ai-assistants.md` (MCP page) and
  `settings.md`; `CHANGELOG.md` [Unreleased]; whatsnew regenerated;
  `charts/README.md` for the value.

## Public API / types
```go
type Access int
const ( accessUnset Access = iota; AccessRead; AccessWrite )
type Tool struct { ...; Access Access }
func (r *Registry) SetReadOnly(on bool)        // atomic, live-switchable
func (r *Registry) ReadOnly() bool
var ErrReadOnly = errors.New("kubebay MCP is read-only: this tool can change cluster state and is disabled")
```
`tools/call` in read-only returns a JSON-RPC error (same shape as unknown
tool, distinct message) before any handler runs. `SetReadOnly` is driven by the
resolved setting so the desktop toggle takes effect without a restart.

Precedence on a shared engine (in-cluster or OIDC): flag/env/Helm is the only
source and the UI is locked. On the desktop: the Settings value; the flag/env,
if set, wins and locks the toggle with the reason "set by flag/env".

Bench result JSON:
```json
{"startedAt":"...","server":"kubebay x.y","cluster":"kind-...",
 "scenarios":[{"id":"...","pass":true,"durationMs":1234,"toolCalls":5,"error":""}],
 "summary":{"passed":0,"failed":0,"totalMs":0},"baselineMeasured":false}
```

## Security considerations
- Read-only must fail closed: a tool with unset Access never registers; the
  filter is applied in the registry so both list and call share one gate (no
  handler-level checks to forget).
- Gate is independent of the proposals approval flow: with read-only on,
  `propose_change` creates no proposal and writes no audit entry for a
  mutation; the refused call is itself audited as a refused MCP call if the
  existing path records calls.
- Shared engine: switch is operator-only, not changeable by any user via
  `/api/mcp`; per-user scope is unchanged. Nothing widens RBAC or data read.
  Secret values stay unavailable.
- Read-only can be turned on by a user on desktop but, being tightening, the
  lock only blocks changes on shared engines.
- Bench harness: reads a kubeconfig path only via explicit `--kubeconfig`,
  refuses the default `~/.kube/config` and any context not named `kind-*`;
  never contains credentials in the output JSON.

## Test plan (TDD, tests first)
- Go: registry in read-only omits write tools from list and refuses call with
  `ErrReadOnly`, handler not invoked; off keeps today's list exactly.
- Guard: enumerate `kubetools.Register` output on a fresh registry and assert
  each tool name is in an explicit table `{name: read|write}` and equals its
  `Access`; fails on a registered tool missing from the table. Also assert
  every `AccessRead` tool's handler cannot reach `Proposals`/`Writes` deps
  (built with nil sentinels that fail the test when touched).
- `resolveMCPReadOnly` table test: flag, env (`1/true/yes`), settings, shared
  lock, precedence.
- httpapi: GET shows locked state; PUT refused when locked; persisted when not.
- Helm: chart test renders flag/env from `mcp.readOnly` (existing
  chart-*.test.mjs style).
- Web: vitest for the Settings switch (disabled with reason when locked);
  shellAdoption guard unaffected (uses ui components only).
- Bench: `node --test` with a fake MCP client and fake scenario file: pass,
  fail, timeout, error cases, JSON shape, refusal of non-kind contexts, no
  network access.
- Docs: website `npm test`, help.test limits, `whatsnew-gen`.

## Failure modes
- Toggle flipped while a call is in flight: the call already past the gate
  completes; later calls refuse. Documented.
- Settings file unreadable: default off (as today) unless flag/env says on.
- Flag and settings disagree: flag/env wins, UI shows locked reason.
- Client has a cached tool list: a call to a hidden tool returns the clear
  error, not "unknown tool".
- Bench: scenario times out, MCP server exits mid-run, malformed result; each
  records `pass:false` with `error` and continues; JSON is always written.

## Out of scope
- New MCP tools; per-tool allow lists; per-user read-only on a shared engine.
- Running the benchmark against any real cluster, starting Docker/OrbStack, or
  fault injection tooling; baseline numbers are NOT measured and the README
  and docs state that.
- Building or shipping the desktop app.
