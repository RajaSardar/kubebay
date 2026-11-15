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
- The UI is served under a strict Content-Security-Policy: scripts, styles, fonts, images, workers
  and connections only from the engine's own origin (plus its WebSocket), the one inline script
  allowed by its exact SHA-256, no `eval`, no plugins, no framing. A script injected into the page
  therefore doesn't run. The policy comes from the engine, so the desktop app's webview and a
  browser get the same one; Tauri's own `csp` setting only covers assets bundled into the app,
  and the desktop app bundles none: its window loads the engine's page.
- The desktop app's window may call the updater commands only while it is showing a page from
  `http://127.0.0.1` (the engine's port is 9898, or a free one when that is taken), and an update
  installs only if its signature verifies against the key the app was built with.
- Zero telemetry by default; opt-in collection is anonymous with a public payload schema.
