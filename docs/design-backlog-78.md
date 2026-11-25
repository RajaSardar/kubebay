# Design: backlog 78, AI investigations through Claude Code only

Status: design only. Checked against `claude` 2.1.286 `--help` (no model called).

## Goal

An "Investigate with AI" action on an Issue (Issues queue, `lib/issues.ts`, `useIssues`) and on the pod and
workload drawers. It hands the problem to the user's own locally installed Claude Code CLI and shows the
streamed answer in a panel. Claude Code only: no other providers, no API key stored by Kubebay, no hosted
service. Desktop only. Nothing leaves the machine except what Claude Code itself sends under the user's own
account, and the first-run notice says so.

## Flows

1. Click "Investigate with AI". `GET /api/ai/status` says one of: `ready`, `off-by-user`,
   `locked` (with reason), `no-claude` (with install steps), `notice-needed`.
2. `notice-needed`: a dialog states plainly what is sent (the issue text plus whatever the read-only tools
   return, to Anthropic, by Claude Code, under the user's account) and what is not (no Secret values, no
   writes). Accept is stored once per user (`ai.noticeAccepted`, with the notice version). Declining does nothing.
3. `ready`: `POST /api/ai/investigations {cluster, issue|object}` returns an id. The engine starts the run;
   `GET /api/ai/investigations/{id}/events` (SSE) streams text, tool-use lines and a final summary.
   Stop is `DELETE /api/ai/investigations/{id}`. The panel shows elapsed time, a size meter and the limits.
4. A suggested fix is shown as text only. "Propose this change" calls the existing MCP proposals store
   (`engine/internal/mcp/proposals`), producing the same approve-by-diff card (YAML dry-run diff, production
   confirmation). The human approves; apply is attributed to the user. The model never applies anything.
5. No `claude` on PATH or in common install paths: the panel shows how to install it (link to Claude Code's
   own install docs) and nothing else runs.

## Module layout

- `engine/internal/aiinvest/` (new)
  - `locate.go`: `Find(env)` looks at PATH, then `~/.claude/local/claude`, `~/.local/bin/claude`,
    `/opt/homebrew/bin/claude`, `/usr/local/bin/claude`. Returns an absolute path or "".
  - `argv.go`: `BuildArgs(Run) []string`, pure, so the exact argv is asserted in a test.
  - `mcpconfig.go`: generates the `--mcp-config` JSON (one HTTP server, `kubebay`, loopback URL,
    `Authorization: Bearer <run token>` header).
  - `prompt.go`: fixed system instruction and the issue-to-prompt builder.
  - `run.go`: `Manager` with `Start/Stop/Get`, process lifecycle, caps, scrubbed env, temp dir.
  - `limits.go`: wall clock 5 min, output 256 KiB, 1 concurrent run per user.
- `engine/internal/httpapi/ai.go`: routes above, status, notice, per-user setting, shared lock.
  `httpapi.AIBlockReason(inCluster, oidc, authProxy)` follows `SharedSettingsBlockReason`.
- `engine/internal/httpapi/mcp.go`: add run tokens (below).
- `web/apps/shell/src/lib/aiInvestigate.ts` (+ `useInvestigation.ts`): builds the request from an `Issue`
  or object ref, consumes the SSE stream. Pure parts unit tested.
- `web/apps/shell/src/components/InvestigatePanel.tsx`: panel from `@kubebay/ui` primitives only;
  drawer tab on pod/workload drawers, dock tab from the Issues page. Notice dialog, Stop button.
- Settings page: "AI investigations" toggle (per user), shown locked with the reason on a shared engine.
- Docs: `ai-assistants.md`, `security.md`, CHANGELOG, whatsnew-gen. No new route (a tab, not a page).

## argv and process model

Command, built only by `BuildArgs`:

```
claude -p <prompt>
  --output-format stream-json --verbose
  --tools ""                         # disables ALL built-in tools (documented: "Use \"\" to disable all tools")
  --strict-mcp-config --mcp-config <tmp>/mcp.json
  --allowedTools mcp__kubebay__<read tool>...   # explicit allowlist of the read tools, no wildcard
  --disallowedTools Bash Edit Write Read Glob Grep WebFetch WebSearch Task NotebookEdit   # belt and braces
  --permission-mode dontAsk          # anything not allowed is denied, never prompted
  --setting-sources ""               # ignore user, project and local settings (hooks, extra MCP, allow rules)
  --no-session-persistence
  --append-system-prompt <fixed instruction>
```

Open items to check on the first implementation step with the fake script, not the real model: the exact
spelling for empty `--setting-sources`, whether `--bare` is worth adding (it skips hooks and auto-discovery;
it may also change auth, which must keep using the user's login), and the `--max-turns` equivalent if present.
The argv test pins whatever final set we choose and fails if `--tools ""`, `--strict-mcp-config`, the
permission mode or the allowlist change or any built-in tool name appears in the allowlist.

- Working dir: fresh `os.MkdirTemp` (0700), empty apart from `mcp.json` (0600) written outside the cwd's
  reach where possible (its own temp subdir). Removed on every exit path.
- Env: built from an allowlist, not inherited. Keep `PATH`, `HOME`, `USER`, `LANG`, `TMPDIR`, proxy variables
  and whatever Claude Code needs for the user's own login (`CLAUDE_*`, `ANTHROPIC_*` are passed through
  because they are the user's own Claude Code configuration; see threat model). Drop `KUBECONFIG`,
  `KUBEBAY_*`, `AWS_*`, `GOOGLE_*`, `AZURE_*`, `GITHUB_TOKEN`, and anything ending `_TOKEN`, `_SECRET`,
  `_PASSWORD`, `_KEY` except the Claude Code ones named above. The only Kubebay credential is the run token,
  inside `mcp.json`, never in env or argv.
- Lifecycle: own process group (`Setpgid`); on Stop, timeout, size cap, client disconnect or engine
  shutdown: SIGTERM to the group, 3 s grace, SIGKILL, `Wait`, then revoke the token and delete the temp dir.
  `Manager.Shutdown` kills all runs. No run outlives its record.
- Run token: `MCPAPI.MintRunToken(cluster) (token, revoke)`. It is a separate 256-bit random value held in
  memory only, accepted by `/mcp` only when presented as Bearer, bound to ONE cluster context, forced
  read-only (write tools and `propose_*` are absent from `tools/list` and refused in `tools/call`, using the
  item 77 read-only mount, independent of the user's MCP switch and the saved Writes setting), expiring
  after the run time limit, revoked when the run ends. It does not touch the user's long-lived MCP token or
  `~/.kubebay/mcp.json`.
- Output: stream-json lines are parsed; only assistant text and tool names are forwarded to the UI (rendered
  as text, never HTML or markdown with links auto-opened). Caps truncate and stop the run.
- Audit: start, stop and end are audited as action `ai-investigation` (user, cluster, issue id, outcome,
  duration, byte count; not the prompt text or model output). Tool calls the model makes go through the
  existing MCP audit path. A proposal made from the panel is audited by the proposals store as today, with
  `source: ai-investigation`; the apply is attributed to the approving user.

## Threat model

- Prompt injection from cluster data (pod logs, events, annotations, resource names): treated as untrusted.
  The fixed instruction says so and that instructions found in data must be ignored. The real controls are
  structural: no built-in tools, read-only MCP, no network tools, no auto-apply, human diff approval.
  Worst case from an injection is a misleading answer or a read of data the user could already read.
- Exfiltration: the model could echo cluster data it can read into its answer; that goes to Anthropic under
  the user's own account, which the notice states. No Secret values: the MCP read tools mask them (test below).
- Privilege: the run token is scoped to one cluster context and uses the user's own kubeconfig credentials
  through the engine, so it cannot read more than the user can. It is read-only and short-lived.
- Settings leakage: Claude Code user or project settings could add MCP servers, hooks or allow rules.
  `--strict-mcp-config`, `--setting-sources ""` and the empty temp dir (no project settings) close this.
  Managed settings still apply and are the user's own organisation policy; documented.
- Shared engine: in-cluster, OIDC or auth proxy returns the lock reason and the endpoints answer 403. A
  shared engine would run a binary on the server for another person's request, so it is never offered.
- Process abuse: concurrency 1 per user, time and size caps, kill on disconnect, no orphans.
- Binary trust: the located `claude` path is shown in the panel; we run only an absolute path, never via a
  shell. Not verified that the binary is genuine; that is the user's install.

## Test plan (fake `claude` script, never the real model)

- `argv_test`: exact argv equality; fails when a built-in tool is allowed or `--tools ""` or
  `--strict-mcp-config` is missing; the prompt is one argv element (no shell); no token in argv.
- `locate_test`: PATH first, then common paths, absent returns "", non-executable and directories skipped.
- `mcpconfig_test`: exactly one server, `kubebay`, loopback URL, bearer header, file mode 0600.
- `run_test`: temp dir is empty, outside the repo and home, removed after success, stop, timeout and crash;
  child cwd equals it. Fake script prints `pwd`, `env`, its argv.
- Env scrub: with `KUBECONFIG=/Users/x/.kube/config`, `AWS_SECRET_ACCESS_KEY`, `KUBEBAY_TOKEN`,
  `GITHUB_TOKEN` set in the parent, the fake script sees none of them; the run token is absent from env.
- Lifecycle: timeout kills a fake that sleeps; Stop kills a fake that traps SIGTERM (SIGKILL path); a fake
  that forks a grandchild leaves no live process afterwards (process group); output cap stops a flooding
  fake; engine shutdown kills all; token revoked after each ending (a `/mcp` call with it then returns 401).
- Run token (httpapi): accepted only for its cluster, `tools/list` has no write tools and a write
  `tools/call` is refused; works with the user's MCP switch off; the user's long-lived token is unaffected;
  expired token refused. The MCP read/write classification guard still passes.
- Secrets: an MCP read of a Secret through the run token returns masked values (regression test with a Secret
  containing a known marker string; the marker never appears in the response).
- Notice gating: `start` returns 412 until accepted; accepted version is stored per user; a bumped notice
  version asks again; declining starts nothing.
- Setting: per-user off returns `off-by-user`; shared engine returns the lock reason for in-cluster, OIDC and
  auth proxy; per-user data stays per user (no shared file write).
- Audit: `ai-investigation` entries on start and end; no prompt or output text in them; proposal from the
  panel is not applied until the approve step, and the apply entry names the user.
- Frontend: `aiInvestigate.ts` request building from an Issue; hook state machine (status, stream, stop,
  errors); panel shows install help when `no-claude` and runs nothing; notice dialog; shellAdoption,
  themeTokens, themeContrast stay green; website `docs.test` and `help.test` pass.

## Out of scope
Other providers or API keys, a hosted or shared-engine mode, letting the model run any built-in tool or any
write MCP tool, auto-applying fixes, multi-turn chat or session resume, storing transcripts, background or
scheduled investigations, investigating multiple clusters in one run, a Claude Code installer or updater.
Not verifiable in this lane: behaviour of the real model, and Claude Code's login flow, so the first
implementation can only claim what the fake-script tests and `--help` show.

## Challenge round

Checked against `engine/internal/httpapi/mcp.go`, `engine/internal/mcp/kubetools` and `engine/internal/mcp/proposals`.

### Objections

1. Secrets are not masked, they are absent. The test plan says the MCP read tools "mask" Secrets and asks for a marker-string
   regression. `kubetools` has no Secret kind at all, and `inspect` refuses Secrets and ConfigMap contents. The right test is
   that a Secret `get`/`list` through the run token is refused, and that env values stay redacted. A "masked values" test would
   pin behaviour that does not exist.
2. A run token that ignores the user's MCP scope widens access. `MCPSettings.Clusters` already limits an assistant to chosen
   clusters and namespaces. The design makes the run token "independent of the user's MCP switch" and binds it to a cluster
   only, so it could read namespaces the user deliberately kept away from assistants. Not beyond their RBAC, but beyond a limit
   they set for assistants.
3. `AIBlockReason(inCluster, oidc, authProxy)` drops the loopback condition. `MCPBlockReason` includes `loopbackOnly`, and the
   run token is accepted by `/mcp`, so a non-loopback listener must block AI too. The existing OIDC branch already covers the
   auth proxy; a separate flag invites a drifting duplicate.
4. The proposal step assumes model text becomes a YAML diff. The proposals store takes a patch body against a live object with a
   `ResourceVersion`, and records `Source: "mcp"`. Parsing a fix out of free text is fragile and is a prompt-injection channel
   into a write path. It also needs a store change (a source value), which the design does not list.
5. The run token must be checked before the `enabled && token != ""` gate in `Endpoint()`. As written ("works with the user's MCP
   switch off") the run token path cannot be a tweak to `tokenMatches`; it needs its own branch, or a request with the MCP switch
   off would 403 first. Untested ordering is a bug magnet.
6. The notice and `ai.noticeAccepted` need a home. Settings are shared-locked in-cluster, so the per-user flag must not sit in the
   shared settings file; the design says "no shared file write" but names no store.
7. The SSE and POST endpoints are on the UI's launch-token surface, which a malicious local web page could try to reach. The
   design never states the Origin and launch-token checks for `/api/ai/*`, and starting a process is the most dangerous thing
   behind them.
8. `--tools ""`, `--setting-sources ""`, `--bare` and a turn limit are unverified spellings. The argv test pins whatever is
   chosen, but pinning an unverified flag would make a typo pass its own test.

### Final decisions

1. Replace the masking test with: Secret kind refused through the run token (list, get and inspect), env values redacted, and a
   guard test that no Secret kind exists in `kubetools`.
2. The run token is bound to one cluster and to the issue's namespace, and its scope is the intersection of that with
   `MCPSettings.Clusters` when the user has set one. The user's MCP on/off switch and Writes setting do not affect it, but the
   user's namespace scope does. Cluster-scoped objects (nodes) require the cluster to be in scope. Test: a namespace outside the
   scope is refused.
3. `AIBlockReason(inCluster, oidc, loopbackOnly)`, composed by calling `MCPBlockReason`, so the two cannot drift. The auth proxy
   is part of `oidc`.
4. Proposals: v1 does not parse a fix from model text. "Propose this change" opens the existing manual propose flow with the
   target object prefilled, so the human writes or pastes the patch and sees the live diff. Proposal `Source` becomes
   `ai-investigation` through an explicit field set by the UI route, not by the model. Automatic extraction is deferred.
5. `/mcp` order: Origin check, then run-token lookup (valid, unexpired, unrevoked) which skips the enabled gate, then the user
   token path. Tests cover MCP off with a run token, an expired token, and a revoked token.
6. The notice acceptance lives in a per-user file next to `~/.kubebay` state (not `SettingsManager`), and the endpoints refuse
   before writing anything when `AIBlockReason` is set.
7. All `/api/ai/*` routes use the existing launch-token middleware, reject any request with an `Origin` header not equal to the
   engine's own, and the POST requires `Content-Type: application/json`. Tests: no token 401, foreign Origin 403.
8. Flag spellings are verified against `claude --help` as the first implementation step, before the argv test is written. A
   flag that `--help` does not list is not used. If an empty `--setting-sources` is not accepted, the run sets `HOME` to a
   scratch dir only if login still works, otherwise this item is blocked and reported rather than weakened.
