# Design: auth-proxy header sign-in (backlog 81)

Status: design only. No implementation yet.

## Goal

Let the in-cluster engine take user identity from headers set by an
authenticating reverse proxy (oauth2-proxy, an ingress with auth, a corporate
gateway) as an alternative to built-in OIDC. The identity then behaves exactly
like the OIDC one: the engine impersonates the user against the API server, so
Kubernetes RBAC decides what they see. Opt-in, off by default.

## Data sources

- TCP peer address: `r.RemoteAddr` only. `X-Forwarded-For`, `Forwarded` and
  `X-Real-IP` are never read for the trust decision.
- Request headers, honoured only from a trusted peer: user header, optional
  groups header (comma separated), optional shared-secret header.
- Config: flags with env twins, set by the Helm chart.
- Downstream, the identity is carried in context as `clusters.Identity`
  (`Name`, `Groups`), the same value `Authenticator.Middleware` stores, so
  `IdentityFromContext`, per-user pools/caches, `audit.RecordCtx` and
  `rest.ImpersonationConfig` (manager.go) need no change.

## Module layout

- `engine/internal/authproxy/` (new, pure, no HTTP server deps)
  - `config.go`: `Config`, `Parse(...)`, `Validate()`.
  - `trust.go`: `Trusted(remoteAddr string) bool` over parsed `[]netip.Prefix`.
  - `headers.go`: `ParseIdentity(h http.Header) (clusters.Identity, error)`.
  - `middleware.go`: `(*Authenticator).Middleware(next)`.
- `engine/internal/httpapi/server.go`: `Deps.AuthProxy *authproxy.Authenticator`;
  a `d.identityMiddleware()` picks OIDC or proxy (never both); `requireToken`
  accepts a verified proxy request the way it accepts an OIDC session.
  `/api/auth/me` answers from the proxy identity; login/logout routes are not
  mounted in proxy mode.
- `engine/cmd/kubebay/main.go`: flags, startup conflict checks, passes the
  proxy flag into `SharedSettingsBlockReason`.
- `charts/kubebay`: `values.yaml`, `templates/deployment.yaml`, RBAC template.
- Docs: `website/src/content/docs/security.md` and `install.md`; CHANGELOG.

## Public API and types

Flags (env in brackets, `KUBEBAY_AUTH_PROXY_*`):

- `--auth-proxy-user-header` (required to enable the mode), e.g. `X-Auth-Request-Email`.
- `--auth-proxy-groups-header` optional, e.g. `X-Auth-Request-Groups`.
- `--auth-proxy-trusted-cidrs` required, comma-separated CIDRs.
- `--auth-proxy-secret-header` and `--auth-proxy-secret` optional; the secret
  is read from env/file in the chart (a Secret ref), compared in constant time.
- `--auth-proxy-allow-any-peer` explicit acknowledgement for empty or
  `0.0.0.0/0` / `::/0` CIDRs.

```go
type Config struct {
    UserHeader, GroupsHeader, SecretHeader, Secret string
    TrustedCIDRs  []netip.Prefix
    AllowAnyPeer  bool
}
func (c Config) Validate(oidcEnabled bool) error
type Authenticator struct{ /* Config + logger */ }
func New(c Config) (*Authenticator, error)
func (a *Authenticator) Enabled() bool            // nil-safe
func (a *Authenticator) Identify(r *http.Request) (*clusters.Identity, error)
func (a *Authenticator) Middleware(next http.Handler) http.Handler
```

Limits: user value 1..256 bytes, group value 1..256 bytes each, at most 64
groups, total groups header at most 8 KiB; no bytes < 0x20 or 0x7f, no
non-UTF-8. Values are trimmed of surrounding spaces only.

## Security considerations

- Trust is by the direct peer only. A peer outside the CIDRs gets 401 on every
  route including static files and `/api/auth/*`; there is no anonymous
  fallthrough and no fallback to the launch token.
- Trusted peer with a missing/empty user header: 401. Secret header configured
  and wrong or absent: 401 (constant-time compare).
- After the decision the handler deletes the identity and secret headers from
  the request before passing it on, so nothing downstream can re-read them;
  `Impersonate-*` headers from clients are already ignored by the engine (it
  builds impersonation from context), and a test pins that.
- Startup refusals (exit non-zero, clear message): proxy mode with an OIDC
  issuer set; empty, `0.0.0.0/0` or `::/0` trusted CIDRs without
  `--auth-proxy-allow-any-peer`; groups header or secret header set without a
  user header (dead config). Trusted CIDRs are required in every case.
- The proxy must be the only path to the pod. Docs say to add a NetworkPolicy
  and CIDRs scoped to the proxy pod/ingress controller, not the pod network.
  Any other pod inside the trusted CIDR can forge identity; this is stated.
- Same data rules as OIDC: per-user pools and caches keyed by identity; usage
  history stays off; `SharedSettingsBlockReason` gets a proxy case (read-only
  settings); Prometheus all-users rule unchanged; no Secret values shown.
- Mutations audit with user and gvr via `audit.RecordCtx` unchanged.
- Chart RBAC: the engine ServiceAccount already needs `impersonate` for
  users/groups under OIDC; the template grants it when either OIDC or proxy
  mode is on, and nothing more. Impersonating `serviceaccounts` and
  `userextras` stay out.
- Log peer and rejection reason, never header values or the secret.

## Test plan (TDD, tests first)

Unit, `authproxy`:
- CIDR parse/validate: empty, `0.0.0.0/0`, `::/0`, garbage, IPv4-mapped IPv6
  peer, valid ranges; allow-any flag lifts only the wide-range refusal.
- Trusted vs untrusted peer; `X-Forwarded-For` naming a trusted IP from an
  untrusted peer is ignored.
- Spoofed user header from untrusted peer: 401, handler not called.
- Header from trusted peer: identity in context, headers stripped downstream.
- Missing/empty user header, wrong or missing secret: 401.
- CRLF, NUL, tab, other control bytes, oversized user/group values, group
  count above the cap, invalid UTF-8: 401, no partial identity.
- Conflict: `Validate(oidcEnabled=true)` errors; startup helper test in cmd.

httpapi:
- End to end following `shared_state_oidc_test.go`: fake-clientset or the
  existing test seam, two proxy users, one limited to namespace `a`; the
  shared engine returns 403/empty for namespace `b`, and the impersonated
  identity reaches the client per user. Per-user cache not shared.
- `/api/auth/me` reflects the proxy identity; settings PUT is 403 with the
  proxy reason; history stays off.
- `SharedSettingsBlockReason` table test extended.

Chart: a helm-template test (existing chart tests style, or a script test)
that flags/env render only when enabled, the secret comes from a Secret ref,
and the impersonate rule appears. Website `docs.test`, `help.test` untouched
unless a UI string changes. UI needs no change beyond showing the user name
already provided by `/api/auth/me`; the sign-out link is hidden in proxy mode.

## Failure modes

- Wrong CIDRs: everyone gets 401; the log line names the peer address so the
  operator can fix it. Not fail-open.
- Proxy drops the header: 401 for all, not anonymous.
- Proxy sends a user RBAC does not know: the API server returns 403s, shown as
  such.
- Ingress terminates on a node IP (SNAT): peer is the node; docs explain
  `externalTrafficPolicy: Local` or an in-cluster proxy.
- IPv6/IPv4-mapped peers are normalised with `Unmap()` before matching.
- Missing impersonate RBAC: the API server errors per request; surfaced.

## Out of scope

- Verifying JWTs or signed headers from the proxy (a later item).
- Mixed mode (OIDC plus proxy), per-route trust, or trusting `X-Forwarded-For`.
- Desktop app use; this mode is for the shared in-cluster engine only.
- A sign-in page, sessions or refresh handling: the proxy owns them.
- Extra user attributes (`Impersonate-Extra-*`, UID).
- Live cluster verification in this item: tests use fakes and httptest.

## Challenge round

Checked against engine/cmd/kubebay/main.go, engine/internal/httpapi/server.go,
auth.go, the `*BlockReason` helpers, and charts/kubebay. Each objection ends
with a final decision.

1. **Scope trap: "OIDC on" is a boolean fanned out to about 11 call sites, not
   one.** The plan names only `SharedSettingsBlockReason`. In main.go,
   `auth.Enabled()` also feeds `setupLocalShell`/`localshell.Allowed`,
   `SharedHelmReposBlockReason`, `AuditFeedBlockReason`, `WarmPolicyBlockReason`,
   `HistoryBlockReason`, `newMCP`/`MCPBlockReason`, `newTriage`,
   `newExtensions` and `DiscoveryBlockReason`. In server.go,
   `d.authEnabled()` also gates `protectClustersHandler` and
   `disconnectClusterHandler`. If only settings learn about proxy mode, a
   shared proxy-mode engine would still allow a local shell, shared Helm repos,
   the MCP token, the shared audit feed and shared cluster disconnect for every
   user. That widens access beyond RBAC. **Decision:** main.go computes one
   `sharedIdentity := auth.Enabled() || proxy.Enabled()` and passes that to
   every existing site, with no signature changes. `Deps` gets one method,
   `d.identityMode()` (replacing the bare `authEnabled()` uses), so the two
   cluster handlers follow. A table test in httpapi asserts that every
   `*BlockReason` helper returns its shared-mode reason when `oidcEnabled=true`.
   A grep-style guard test fails if main.go passes `auth.Enabled()` to a
   `*BlockReason` or `setup*` call. That is the audit-guard pattern the repo
   already uses.

2. **"401 on every route" breaks the kubelet probes and is wrong for `/mcp`.**
   The readiness and liveness probes hit `/api/healthz` from the node IP, which
   is not in the proxy CIDRs. A blanket 401 would fail readiness and restart the
   pod in a loop. `/api/healthz` is registered before any group, and `/mcp` sits
   beside the token group on purpose. **Decision:** the proxy middleware
   guards the same group `requireToken` guards, plus static files and
   `/api/auth/*`. `/api/healthz` stays public and `/api/auth-mode` stays
   public. `/mcp` is disabled in proxy mode through `MCPBlockReason` (decision
   1), so the unauthenticated Bearer-token endpoint is never mounted. The test
   plan gains: healthz answers 200 from an untrusted peer, and `/mcp` returns
   the blocked response in proxy mode.

3. **Reuse: do not add a second `Authenticator` or a parallel
   `requireToken` branch.** `httpapi.Authenticator` already exists, and
   `requireToken(token, auth)` takes the concrete OIDC type. **Decision:**
   `authproxy` exposes only `Identify(r) (*clusters.Identity, error)` and
   `Config`/`New`/`Validate`, and is named `authproxy.Verifier` to avoid the
   name clash. httpapi gets a small interface, `identitySource{ Enabled() bool;
   Identify(*http.Request) (*clusters.Identity, error) }`, and one middleware
   placed before `requireToken`. A verified request carries the identity in
   context, and `requireToken` passes any request that already has an identity
   in context. Its signature stays `requireToken(token, auth)`, and OIDC's
   `sessionFrom` check becomes the same context check. Request-time
   verification runs once, in one place.

4. **Security hole: the launch token must not become an alternative
   credential.** main.go always mints a token (`httpapi.NewToken`) when none is
   supplied. In proxy mode a request from a trusted peer that has the user
   header is authenticated by the proxy. A request carrying a valid
   `X-Kubebay-Token` but no proxy headers, from an untrusted peer, must still
   get 401, otherwise the "no fallback" claim is false and the token would act
   with the engine's own ServiceAccount identity (no impersonation). **Decision:**
   in proxy mode `requireToken` is called with `token=""` semantics
   replaced by "identity required". Implement it as: proxy mode ignores the
   launch token entirely. A test sends a valid token from an untrusted peer and
   from a trusted peer without the user header, and expects 401 for both.

5. **Websockets and the strip step.** Terminal, logs and port-forward use
   WebSocket upgrades through the proxy. Headers are only on the upgrade
   request, so identity must be bound to the connection at upgrade time. This
   already works for OIDC because the middleware runs on the upgrade. Stripping
   headers is cosmetic given that nothing reads them. **Decision:** keep the
   strip, but state it as defence in depth. Add a test that a WS upgrade from a
   trusted peer carries the identity into the stream handler's context. Do not
   claim the strip is a security boundary.

6. **Shared-secret header: keep, but fix the weakness.** A static shared secret
   is the only protection against a pod inside the trusted CIDR. **Decision:**
   if `--auth-proxy-trusted-cidrs` is wider than a /24 (v4) or /64 (v6) and no
   secret is set, startup refuses unless `--auth-proxy-allow-any-peer`. This
   makes the narrow-CIDR or secret choice explicit. The secret is read from a
   file or env only (never a flag value, since flags show in `ps` and pod
   specs). The design's `--auth-proxy-secret` flag is dropped in favour of
   `--auth-proxy-secret-file` plus the env twin. The chart mounts the Secret as
   a file.

7. **Group header ambiguity.** A comma split breaks groups that contain commas
   (some LDAP DNs) and oauth2-proxy emits them comma separated. Also, a group
   named `system:masters` forwarded by the proxy is impersonable if the chart
   role is unscoped. **Decision:** keep comma separation, reject an empty
   element, de-duplicate, and document the limit. In the chart, proxy mode uses
   the same `impersonation.users`/`impersonation.groups` allow-lists as OIDC,
   and `NOTES.txt` warns when both are empty. Add a test that the engine
   refuses the `system:` prefix for the user name unless `Config` opts in
   (`--auth-proxy-allow-system-identities`, default off). It would otherwise
   let a header turn into `system:admin`-style identities. Final decision:
   refuse `system:` users and the `system:masters` group by default, 401.

8. **Chart rendering is testable the existing way.** The plan said "helm-template
   test (existing chart tests style, or a script test)". There is a precedent
   at scripts/chart-audit.test.mjs, which uses `helm template` and skips when
   helm is missing. **Decision:** add `scripts/chart-authproxy.test.mjs` in
   that style. Note the skip: on a machine without helm it proves nothing, so
   the CHANGELOG must say whether it ran. rbac.yaml and deployment.yaml are
   gated on `.Values.oidc.issuerUrl` today. Introduce a helper
   `kubebay.sharedIdentity` in `_helpers.tpl` and use it for the rbac gate,
   instead of duplicating an `or` expression. The chart fails to render with
   `fail` when both `oidc.issuerUrl` and `authProxy.enabled` are set.

9. **UI needs a small change after all.** `/api/auth-mode` returns `open`,
   `oidc` or `token`; in proxy mode it would currently return `token` or
   `open` and the shell (web/apps/shell/src/lib/api.ts) would show a
   launch-token prompt. **Decision:** add `mode: "proxy"` to the endpoint; the
   shell treats it like a signed-in session (user from `/api/auth/me`), hides
   the sign-in prompt and the sign-out link, and a 401 shows a plain
   "your proxy did not authenticate this request" banner (a `@kubebay/ui`
   banner, no new colours). Add a Vitest case for the api.ts mode handling. The
   backlog line "UI needs no change" is dropped.

10. **`/api/auth/me` when unauthenticated.** In proxy mode there is no state in
    which an unauthenticated 200 `{authenticated:false}` is useful; the
    middleware already returns 401. **Decision:** keep 401 and let the UI use
    it for the banner above.

11. **IPv4-mapped and `RemoteAddr` parsing.** `RemoteAddr` is `host:port` and
    can be a unix socket or empty in `httptest`. **Decision:** parse with
    `netip.ParseAddrPort`; on any parse failure treat the peer as untrusted.
    Tests use `httptest.NewRequest` with an explicit `RemoteAddr`, because the
    default `192.0.2.1:1234` is easy to forget.

12. **Out of scope additions.** Add explicitly: an in-process hot reload of
    CIDRs (restart to change), and header-based identity for the desktop app.

### Resolved decisions (final)

- One `sharedIdentity` boolean replaces `auth.Enabled()` at every call site,
  with a guard test.
- Probes: `/api/healthz` and `/api/auth-mode` stay public; `/mcp` is disabled
  in proxy mode.
- Package type is `authproxy.Verifier`; httpapi uses an `identitySource`
  interface and a context-based pass in `requireToken`.
- Launch token is ignored in proxy mode; tested from both peer cases.
- Secret comes from a file or env, never a flag value; wide CIDRs without a
  secret need the explicit allow flag.
- `system:` users and `system:masters` refused by default; chart reuses the
  `impersonation` allow-lists and fails to render if OIDC and proxy are both on.
- `/api/auth-mode` gains `proxy`; the shell hides sign-in and sign-out and
  shows a banner on 401. Vitest covers it.
- Chart test is `scripts/chart-authproxy.test.mjs` in the chart-audit style,
  honest about the helm skip. Nothing is verified against a live cluster or a
  real proxy in this item.
