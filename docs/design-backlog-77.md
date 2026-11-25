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

## Challenge round

Checked against `engine/internal/mcp/{tools,server}.go`, `kubetools/propose.go`,
`httpapi/mcp.go` and `cmd/kubebay/mcp.go`. Each objection is followed by the
decision, which supersedes the text above where they differ.

1. **Shared-engine lock and Helm value are dead scope.** `MCPBlockReason`
   already turns MCP off entirely for OIDC and in-cluster engines, and the
   endpoint is loopback-only. There is no shared engine on which the switch
   could matter, so `readOnlyLocked` for "shared", the `charts/values.yaml`
   value, the chart test and `charts/README.md` have nothing to configure.
   Decision: drop all of them. The only lock reason is "set by flag/env".

2. **A switch already exists.** `MCPSettings.Writes` (`writesEnabled`, default
   false) gates `propose_change` today, and the Settings UI has its toggle. A
   second persisted `readOnly` boolean would be two switches with overlapping
   meaning and a four-state matrix. The real gap is narrower: with writes off,
   `propose_change` and `get_proposal_status` are still listed and only refuse
   inside the handler (`t.d.Writes()`), which is the "handler-level check
   someone forgets" the note wants to avoid. Decision: read-only is defined as
   `!Writes()`. No new `MCPSettings` field and no new UI switch. Add
   `--mcp-read-only` / `KUBEBAY_MCP_READ_ONLY` as an operator override that
   forces `Writes()` false (flag wins, persisted `writesEnabled` is left
   untouched); `/api/mcp` GET reports `readOnlyForced` plus the reason and the
   existing writes toggle renders disabled with it. `resolveMCPReadOnly` stays,
   reduced to flag/env parsing (`1/true/yes`).

3. **Gate must be dynamic, not `SetReadOnly(bool)` pushed from settings.**
   Pushing state into the registry creates a second copy that can drift from
   `MCPAPI.conf` (HandleSave, restore at startup, flag). Decision: the
   `Registry` takes a `func() bool` (`Writes`) at construction. `list()` and
   `Get()` consult it live, so the toggle works without a restart and there is
   one source of truth. `Access` stays on `Tool`, required at `Add` (panic on
   unset), and `get_proposal_status` is `AccessWrite` (it only exists to serve
   proposals; the note listed it as read).

4. **"JSON-RPC error" is wrong for this server.** `Handler.call` returns every
   failure, including unknown tool, as a tool result with `isError: true` so
   the model can see it. Decision: a refused write tool returns that same shape
   with the `ErrReadOnly` text, distinct from "unknown tool: ...". Test asserts
   the shape.

5. **Refusals were not audited by the gate.** The audit wrapper is
   `t.audited(handler)` inside `kubetools`; a refusal in `Registry/Get` runs
   before it, so the "refused call is itself audited" line would silently be
   false. Decision: the gate refuses in `Handler.call` via a small `OnRefuse`
   hook that `cmd/kubebay/mcp.go` wires to `auditLog.Record` with action
   `mcp:refused:<tool>`, source `mcp`, client name and request id. A test
   asserts one entry per refusal and zero proposals created.

6. **Annotations are now wrong.** `list()` hardcodes `readOnlyHint: true` for
   every tool, which is false for `propose_change` whenever it is listed.
   Decision: derive `readOnlyHint` from `Access` (write tools: false,
   `destructiveHint` false, since nothing is applied without approval).

7. **Stale server instructions.** `mcpInstructions` tells models "Reads only,
   except propose_change". Decision: build the text per request from
   `Writes()`; in read-only it says reads only and does not mention
   proposals. Tested.

8. **Turning it off must clear pending work.** `HandleSave` already calls
   `Proposals.RejectAll` when writes go off. The flag-forced path has no save
   event, so at startup there are no live proposals (store is in memory), but
   the guard test should cover the `RejectAll` path through HandleSave so the
   behaviour is not lost in the refactor.

9. **The "nil sentinel deps" test is untestable theatre.** Building read tools
   with sentinel `Proposals`/`Writes` that fail when touched does not prove
   anything about future code and is brittle. Decision: replace with the
   explicit `{name: access}` table guard (fails when a tool is added without a
   row, or its `Access` differs) plus a behavioural test: in read-only, call
   every listed tool with `Proposals == nil` and `Writes == func() bool {
   return false }` against the existing fake `Source` and assert no write
   method of the fake was invoked.

10. **Bench scope trap and wording.** Scenario files "written from the public
    benchmark's scenario names" invites copying and a third-party reference in
    a tracked file. Decision: scenarios are authored in our own words from our
    own fault list (crash loop, bad image, OOM kill, unschedulable pod,
    failing probe, missing ConfigMap, broken Service selector, Ingress
    without backend, stuck PVC, scaled to zero) and the README names no
    external product. Also: the bench never starts a cluster or fault
    injection; `run.mjs` only drives an already-running server given
    `--url` and `--token-file` plus `--kubeconfig`. The `kind-*` context
    refusal is enforced on the cluster IDs returned by `list_clusters`, not
    just the kubeconfig argument, since the engine can serve other
    contexts. The token is read from the file and never written to the result
    JSON; the test greps the output for it.

11. **Bench must also check read-only.** Add one fixed scenario family
    `readonly-*` that, against a read-only server, asserts `tools/list` has no
    `AccessWrite` names and `propose_change` is refused. Unit-tested with the
    fake client; no live run.

12. **Docs.** `ai-assistants.md` and `settings.md` document the flag/env and
    the disabled toggle. The CHANGELOG says plainly that the hiding is tested
    with fakes and `httptest` and was not run against a live cluster or a real
    assistant, and that no benchmark numbers were measured.

### Final decisions (summary)
- Read-only == `Writes()` false; one persisted field (`writesEnabled`), plus an
  operator flag/env override that wins and locks the toggle.
- Registry takes a live `func() bool`; `Access` mandatory; write tools
  (`propose_change`, `get_proposal_status`) hidden from `tools/list` and
  refused on `tools/call` as an `isError` tool result.
- Refusals audited via an `OnRefuse` hook; annotations and instructions follow
  the mode.
- No Helm, no shared-engine lock, no new Settings field, no new UI switch.
- Bench is offline-tested with a fake client, own-words scenarios, `kind-*`
  enforcement on cluster IDs, token never serialised.
