# Security Policy

Kubebay holds your Kubernetes credentials. Security issues are treated as the highest
priority class of bugs in this project.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting on this repository:
https://github.com/RajaSardar/kubebay/security/advisories/new

Please include: affected component (engine/web/desktop), reproduction steps or PoC, impact
assessment, and any relevant logs (redacted — never include kubeconfig contents or tokens).

## Response targets

| Step | Target |
|---|---|
| Acknowledgment | 72 hours |
| Triage & severity assignment | 7 days |
| Fix or documented mitigation | 30 days for high/critical |

Reporters are credited in release notes by default unless they prefer otherwise.

## Supported versions

Pre-1.0: only the latest `main` branch receives security fixes.

## Design posture

The full security architecture (threat model, localhost token auth, OIDC impersonation,
plugin sandboxing, telemetry policy) is documented in
[docs/SECURITY.md](docs/SECURITY.md). Notable guarantees:

- The engine binds to `127.0.0.1` only and requires a per-launch session token.
- In-cluster mode authenticates users via OIDC then **impersonates them**, so cluster RBAC
  remains the single source of authorization.
- Zero telemetry by default; opt-in collection is anonymous with a public payload schema.
