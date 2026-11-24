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
