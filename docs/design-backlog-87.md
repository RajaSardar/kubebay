# Backlog 87: run and show the Argo Rollouts dashboard

Supersedes the "do not embed or spawn the upstream dashboard" decision in
`design-backlog-73.md` (Out of scope, and the docs paragraph "Argo's own
dashboard"). The Release view from 73 stays.

## Goal

On the Rollouts page of the desktop app, an **Argo dashboard** tab. Opening it
starts `kubectl-argo-rollouts dashboard` for the selected cluster and shows it
inside the page. No terminal, no copy-paste. Desktop only.

## Decisions

1. **iframe src is a same-origin proxy path**, `/api/rollouts-dashboard/<token>/`,
   not the raw loopback port. A raw port would need `frame-src http://127.0.0.1:*`
   in the CSP and would expose an unauthenticated tool to any local process or
   web page that guesses the port. The proxy needs only `frame-src 'self'`.
2. **CSP change is one directive**: `frame-src 'none'` becomes `frame-src 'self'`
   in `engine/cmd/kubebay/spa.go` `uiPolicy`. `frame-ancestors 'none'` and
   `X-Frame-Options: DENY` stay on the shell. `desktop/src-tauri/tauri.conf.json`
   has `csp: null` (the engine's header is the policy), so nothing changes there.
   The existing `spa_test.go` directive checks are updated to pin `frame-src 'self'`
   and a new test asserts every other directive is byte-identical to before.
3. **Proxy responses** (only under that prefix) override the hardening headers:
   `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'`
   plus the upstream's own scripts allowed from `'self'` only (`default-src 'self'
   'unsafe-inline'; connect-src 'self'`). Upstream `Set-Cookie`, `Location` to
   other hosts and `Access-Control-*` are dropped.
4. **Upstream base path**: use `--root-path <prefix>` (the upstream dashboard has
   this flag). The proxy rewrites nothing. If `dashboard --help` output lacks
   `--root-path`, fail closed: "this plugin version is too old to be shown inside
   Kubebay; upgrade it". Not verified against a real binary in this lane; tests
   use a fake plugin that implements the flag.
5. **Auth of the iframe**: an iframe request cannot carry the engine's Authorization
   header. The credential is the per-run path token (32 random bytes, base64url,
   regenerated on every start, compared in constant time), minted only by an
   authenticated `POST /api/rollouts-dashboard/start`. The proxy also requires
   `Host` to be the engine's loopback host and rejects a cross-site `Origin` or
   `Sec-Fetch-Site: cross-site`. Kubebay `Authorization`, `Cookie`, `X-Kubebay-*`
   and `Origin` headers are stripped before going upstream.

## Flows

- **Open tab**: `GET /api/rollouts-dashboard/status?cluster=` returns one of
  `unavailable` (with reason), `not-installed` (with install help), `stopped`,
  `starting`, `running` (with `url` = proxy path), `failed` (message + stderr tail).
  The UI calls `POST .../start` (body: cluster, optional namespace) when state is
  `stopped`, polls status, and renders the iframe only on `running`.
- **Not installed**: card with `brew install argoproj/tap/kubectl-argo-rollouts`,
  the krew command (`kubectl krew install argo-rollouts`) and the releases link
  (all text, nothing downloaded), and a button back to the Release view.
- **Leave tab or page**: UI posts `.../release`; engine starts a 60 s idle timer.
  Reopening before it fires cancels it and reuses the process. Proxy traffic also
  counts as activity only while a client holds the tab open (heartbeat from the
  UI every 20 s); no heartbeat for 60 s stops it, covering a crashed webview.
- **Cluster disconnect**: `Manager.OnDisconnect` stops that cluster's dashboard.
- **App quit**: engine shutdown calls `StopAll`; Tauri sidecar kill already
  terminates the engine, and the child is in its own process group with
  Pdeathsig where available (Linux) so a hard kill of the engine does not orphan it.

## Process model

New package `engine/internal/rolloutsdash` (modelled on `aiinvest`: `locate.go`,
`env.go`, `procgroup_unix.go` with `//go:build !windows`, `procgroup_windows.go`,
and a cross-compile test).

- **Locate**: `kubectl-argo-rollouts` on PATH, then `/opt/homebrew/bin`,
  `/usr/local/bin`, `~/.krew/bin`, `~/go/bin`; then `kubectl` (same lookup) with
  `argo rollouts` args after confirming `kubectl-argo-rollouts` exists (kubectl
  only dispatches to it). Relative PATH entries ignored. Must be a regular
  executable file. Never downloaded.
- **argv**: `dashboard --kubeconfig <file> --context <ctx> [--namespace <ns>]
  --port <free> --root-path /api/rollouts-dashboard/<token>`. `--namespace` only
  when exactly one namespace is selected. The port is chosen by binding
  `127.0.0.1:0`, closing, and passing it; the plugin binds loopback by default,
  and the health check also verifies the answering socket is `127.0.0.1`. No
  shell, argv slice only; context and namespace validated against the cluster
  list and a DNS-label regexp, and must not start with `-`.
- **env**: only `HOME`, `PATH` (the located dir plus the user's PATH), `KUBECONFIG`
  = the single dedicated kubeconfig file for that cluster, plus `LANG`. No
  `KUBEBAY_*`, no cloud credentials beyond what the kubeconfig's exec plugin
  finds from HOME and PATH (stated in docs).
- **Health**: poll `GET /` on the port up to 15 s (injectable in tests); on timeout
  kill the group and return `failed` with the last 2 KB of stderr (redacted by
  `redact`).
- **Caps**: 1 per cluster (second start returns the existing run), 3 overall
  (fourth returns 429 "close another dashboard first"). Starts for the same
  cluster are serialised by a mutex so a double click cannot spawn two.
- **Exit**: a watcher goroutine `Wait`s; an unexpected exit moves state to
  `failed` with the stderr tail and frees the slot and token.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Another local process connects to the dashboard port | loopback bind only; random port; but loopback is reachable by any local user process, so this is stated in docs as a residual risk of the upstream tool, as with running it by hand |
| Web page in the user's browser guesses `/api/rollouts-dashboard/...` | 256-bit token, Host and Origin checks, no CORS headers |
| Dashboard acts with more rights than the user | it runs as the user with the user's kubeconfig on their machine, the same as the CLI; the tab is hidden on any shared engine |
| Engine identity used on a shared engine | `SharedSettingsBlockReason`-style lock: in-cluster, OIDC and auth-proxy modes return `unavailable` and refuse start/proxy server-side, not just in the UI |
| Argument or env injection through cluster, context or namespace names | argv slice, validated values, scrubbed env |
| Orphan process | process group kill, `StopAll` on shutdown, Pdeathsig on Linux, exit watcher |
| Token leak through Referer or logs | `Referrer-Policy: no-referrer` already global; proxy path is redacted in access logs and audit |
| Upstream mutates the cluster (it can promote, abort) | those actions happen outside Kubebay's confirmation flow; the audit entry records only the start, and the docs say so plainly |

Audit: `rollouts-dashboard-start`, GVR `rollouts-dashboard`, with user and
cluster (and namespace when set), source `rollouts-dashboard`. The audit and
MCP classification guards get the new routes: start is a mutation class, status
and release are read-class, and the MCP surface does not expose any of them.

## Test plan (TDD, fake plugin = a tiny Go test binary or shell script server)

- argv and env construction, including single-namespace vs all, hostile names, no `KUBEBAY_*`.
- locate order, relative PATH ignored, not-installed state and install help.
- lifecycle: start, reuse, idle stop after the (injectable) timeout, cancel of idle on reopen,
  disconnect stop, `StopAll`, no leftover process (check PID gone), unexpected exit.
- health timeout with stderr tail; port that never answers.
- proxy: path token required and constant-time, wrong token 404, header stripping
  upstream (fake records headers), response headers overridden, websocket and SSE passthrough,
  Host and Origin rejection.
- caps 1 per cluster and 3 overall; concurrent start race.
- shared-engine lock: start, status and proxy refused for in-cluster, OIDC, auth-proxy.
- audit entry written; audit and MCP guards pass.
- CSP: only `frame-src` changed; proxy responses framable only by `'self'`.
- cross-compile for windows, darwin, linux; every test Manager `t.Cleanup(m.Close)`.
- UI (vitest): tab hidden with reason on shared engine; install help state; iframe only on
  `running`; heartbeat and release on unmount; headless Playwright mock screenshot.

## Failure modes

Plugin missing, too old (no `--root-path`), port never answers, cluster unreachable
(the dashboard starts but shows its own error; Kubebay does not probe the cluster),
kubeconfig exec plugin needs a TTY (stderr tail shown), plugin exits, cap reached,
webview closed without release (heartbeat expiry), engine restart (token invalid,
UI restarts the dashboard).

## Out of scope

Downloading or bundling the plugin; any shared-engine support; exposing the
dashboard outside loopback; changing the upstream UI; Windows runtime
verification (compiles only); running against a real cluster or the real plugin
in this lane, and the docs will say so.

## Docs

`argo-rollouts.md` (replace "Argo's own dashboard"), `security.md`, and the
Release view text in 73's design note gets a pointer to this one. CHANGELOG
Unreleased: Added the tab, Changed the CSP `frame-src`.

## Challenge round

Read against `engine/internal/httpapi/server.go`, `engine/cmd/kubebay/spa.go`,
`engine/internal/aiinvest`, `engine/internal/localshell` and `tauri.conf.json`.
Each objection is followed by its resolved decision. These decisions override the
sections above where they differ.

### 1. The proxied dashboard is same-origin with the shell (security, blocking)

Objection: decisions 1 to 3 make the upstream UI same-origin with Kubebay. Upstream
JavaScript, or any rollout name, label or image string it renders unsafely, then
runs with the shell's origin. It can read the shell's storage (the launch token) and
call every `/api/*` route as the user. `frame-ancestors 'self'` and the path token do
not help, because the attacker is inside the frame. The threat model has no row for
this.

Resolution:
- The proxied response carries `Content-Security-Policy: sandbox allow-scripts
  allow-forms` and **not** `allow-same-origin`. The iframe element carries the same
  `sandbox` attribute (defence in depth). The frame gets an opaque origin, so it
  cannot reach the shell's storage, cookies or token.
- Consequence for decision 3 and 5: the frame's own calls under the prefix are
  cross-origin with `Origin: null`. Under the prefix only, the proxy answers
  `Access-Control-Allow-Origin: null` (never `*`, never a real origin) and accepts
  `Origin: null` plus the path token. Everywhere else `Access-Control-*` stays
  absent and `Origin: null` is still rejected. WebSocket and SSE use the same rule.
- A second loopback listener (a real second origin) is rejected: it needs
  `frame-src http://127.0.0.1:*`, which decision 1 exists to avoid.
- Test (headless Chromium, not a mock of the browser): a fake upstream page whose
  script tries `parent.localStorage`, `fetch('/api/...')` with no token and reading
  `document.cookie`. All must fail under the sandbox. This is the main security
  test for the lane.

### 2. The auth middleware wraps all of `/api/*` (missed, blocking)

Objection: an iframe cannot send `Authorization`, and the router authenticates
`/api/*`. The plan says the path token is the credential but not where the route
mounts. A careless exemption would be an unauthenticated route in the API tree.

Resolution: `/api/rollouts-dashboard/{token}/*` is mounted outside the
authenticated group, as the only unauthenticated route besides `/api/auth-mode` and
the OIDC callbacks, and is mounted **only** when the engine is local (see 3). A
router test lists every unauthenticated route and pins this set. `status`, `start`,
`heartbeat` and `release` stay inside the authenticated group.

### 3. "Desktop only" is not defined, and a non-loopback listener leaks it (security)

Objection: the plan locks in-cluster, OIDC and auth-proxy, but a local engine started
with a non-loopback `--addr` would let other hosts reach the proxy path, and the
Host check alone does not cover a spoofed header.

Resolution: define "local" as: not in-cluster, no OIDC, no auth-proxy, and the
engine's listener is loopback. Otherwise `status` returns `unavailable` with the
reason, the proxy route is not mounted, and `start` returns 403. The check is one
function with a table test over all combinations. Host check is kept but is not the
control.

### 4. Pdeathsig does not cover the target platform (wrong assumption)

Objection: `Pdeathsig` exists only on Linux, and nothing in this repo uses it
today. The product is a macOS app, where a hard-killed engine orphans the plugin,
which keeps a cluster connection and a listening port.

Resolution: on start the engine writes `<datadir>/rollouts-dashboard.pids`
(pid, start time, binary path). On engine startup a sweep kills only entries whose
pid still maps to the same binary path and start time (never a reused pid). Model
it on `internal/localshell/sweep.go`. Drop the Pdeathsig claim from the docs and
keep it only as a Linux bonus. Test: write a stale entry for a fake plugin, run the
sweep, assert the process is gone and an unrelated process with a reused pid is not.

### 5. The port and the health check can be hijacked (security, TOCTOU)

Objection: bind, close, pass the port leaves a window in which another local process
takes the port. The health check "the answering socket is 127.0.0.1" would then pass
against the wrong server, and the proxy would forward the user's iframe to it.

Resolution: the health check also requires that the child process is still alive
(its `Wait` has not returned) and that `GET <root-path>/` returns 200 with the
upstream's expected content type. If the child exits with a bind error the start
fails with the stderr tail and one retry on a new port (max 2 attempts). Documented
as a residual risk shared with running the tool by hand. Test: a squatter that holds
the chosen port while the fake plugin fails to bind; assert `failed`, not `running`.

### 6. Heartbeat and idle timers are fragile in a webview (Tauri constraint)

Objection: a 20 s heartbeat and 60 s expiry will kill the dashboard when WKWebView
throttles or suspends timers for an occluded or minimised window, so the user returns
to a dead tab. Also "release" and "heartbeat" are POSTs and the audit guard classes
POSTs as mutations.

Resolution:
- Heartbeat every 30 s, expiry 3 minutes, idle-after-release 60 s unchanged. All three
  are injectable. An open proxied SSE or WebSocket connection counts as a live
  client, so a throttled timer does not matter while the dashboard stream is open.
- If the UI finds `stopped` or an invalid token on return, it restarts silently; this
  is the designed recovery, not an error.
- `heartbeat` and `release` are added to the guard as a separate local-session class
  (no cluster effect, not audited, not exposed to MCP). Only `start` is audited.
  Final classification follows the categories the guard already has; if none fits,
  extend the guard with a named class and a reason, never an allow-all.

### 7. Reuse (missed)

Objection: the plan copies the `aiinvest` layout (`locate`, `env`, `procgroup_*`).
Copying a process-group file for the second time doubles the Windows cross-compile
surface.

Resolution: before writing code, check whether `aiinvest` `locate`, `env` and
`procgroup_*` can move to a small shared package with `aiinvest` as its first
caller; if the change to `aiinvest` is more than a rename, copy instead and note it
in the commit. The dedicated per-cluster kubeconfig comes from
`internal/localshell/kubeconfig.go`, not a new writer. Verify it writes a single
context file with no secret values beyond what the user's own kubeconfig holds.

### 8. Header ordering and logging are asserted, not tested (untestable as written)

Objection: `spaHandler` sets `X-Frame-Options: DENY` before dispatching to the API.
The proxy's `SAMEORIGIN` is only effective if set after, and "path redacted in access
logs and audit" is a claim with no named test.

Resolution: tests assert the final header set on a proxied response and on a normal
API response (DENY unchanged). A test captures the engine's logger output and the
audit record for a proxied request and asserts the token never appears. If any
request logger records the raw path, it is fixed in the same change.

### 9. Docs and honesty

- The version probe runs `dashboard --help` with a 3 s timeout, cached per binary
  path and mtime. The `--root-path` flag is unverified against a real binary; the docs
  and CHANGELOG say so. Fail closed stays.
- An upstream that loads fonts or scripts from another host will render degraded
  under `default-src 'self'`; that is accepted and noted in the docs.
- The dashboard's promote and abort act outside Kubebay's confirmation flow; the
  security page states this next to the audit scope.

### Final decisions (delta from the design above)

1. Sandboxed frame without `allow-same-origin`; `Origin: null` accepted only under the
   prefix with the path token; ACAO `null` only there.
2. Proxy route is the only authenticated-exempt addition, pinned by a router test, and
   mounted only on a local engine.
3. "Local" includes a loopback listener; one tested function decides it.
4. PID file plus startup sweep replaces Pdeathsig as the orphan control.
5. Health check requires a live child and one retry on a lost port race.
6. Heartbeat 30 s, expiry 3 min; open streams count as live; silent restart.
7. Share process helpers with `aiinvest` only if the change is a rename; reuse
   `localshell/kubeconfig.go`.
8. Header ordering and log redaction get named tests.
