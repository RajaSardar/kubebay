# Kubebay

> *A bay is where ships anchor safely. Kubebay is where your clusters come to rest.*

**Kubebay** is a free, open-source, local-first Kubernetes IDE — a modern alternative to
Lens / Freelens / Headlamp with a cleaner UI, dramatically lower resource usage, and the
features power users actually miss: live topology, event timeline, RBAC explorer, and
guarded AI assistance.

| | |
|---|---|
| **Status** | 📐 Design & architecture phase (pre-code) |
| **License** | MIT *(planned — see principles)* |
| **Platforms** | macOS · Windows · Linux · Web (self-hosted in-cluster) |
| **Docs** | [Architecture](docs/ARCHITECTURE.md) · [Tech Stack](docs/TECH_STACK.md) · [Product Requirements](docs/PRODUCT_REQUIREMENTS.md) · [Roadmap](docs/ROADMAP.md) · [Security](docs/SECURITY.md) |

---

## Why Kubebay

The Kubernetes UI landscape in 2026 has a trust and quality vacuum:

- **Lens** went closed-source + subscription + mandatory accounts; telemetry phones home.
- **OpenLens** died unpatched; **Freelens** keeps it alive but Electron-heavy (300–600 MB RAM)
  on an aging UX foundation.
- **Headlamp** is well-governed but visually plain and slow for daily driver use.
- The official **Kubernetes Dashboard was archived** in Jan 2026.

Kubebay's answer: **one Go engine, three surfaces, zero compromises on trust or performance.**

## Principles (non-negotiable)

1. **Local-first.** No accounts, no cloud control plane, no mandatory telemetry. Opt-in only, ever.
2. **Instant by default.** Every view is a live watch stream. There are no Refresh buttons.
3. **Lightweight by contract.** Hard performance budgets enforced in CI — see [Performance Budgets](docs/PRODUCT_REQUIREMENTS.md#performance-budgets).
4. **One engine, many surfaces.** Desktop (Tauri), standalone web binary, and in-cluster Helm chart all share the same core.
5. **RBAC-aware everywhere.** The UI reflects what you're actually allowed to do.
6. **Keyboard-first.** Command palette (`⌘K`) drives everything; mouse optional.
7. **Truly open source.** MIT license, public roadmap, no bait-and-switch.

## What it looks like (architecture in one paragraph)

A single static **Go engine** owns all cluster communication: shared informers per
`(cluster, resource)` fanning out MessagePack deltas over **one multiplexed WebSocket**, plus
logs/exec/port-forward streaming (WebSocket-first, SPDY fallback). A **React/TypeScript SPA**
renders virtualized views on top of that stream. The same engine ships as a Tauri 2 sidecar
(desktop), a standalone web server (personal), and an in-cluster deployment behind OIDC (teams).

Full details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Feature highlights (planned)

- Live resource tables & detail views for every built-in kind **and any CRD** (discovery-driven)
- Best-in-class log viewer: multi-pod tail, regex, JSON/logfmt pretty-print, previous container
- Integrated terminals (xterm.js) and port-forward manager with persistent sessions
- **Topology view**: real-time owner-reference graph of workloads, services, ingress
- **Event timeline**: chronological cluster story across resources
- **RBAC explorer**: who-can-do-what visualization
- **Helm manager**: install/upgrade/rollback with values-diff preview
- Themes: **Dusk** (default dark), **Dawn** (light), system-follow, high-contrast variants
- Built-in **MCP server** + AI copilot: deterministic analyzers free/keyless, LLM explanations opt-in,
  anonymization toggle, read-only by default
- In-cluster team mode: OIDC SSO, user impersonation → native K8s RBAC decides

## Platform support

| Platform | Form | Phase |
|---|---|---|
| macOS 12+ (Apple Silicon & Intel) | Desktop app (Tauri 2 + engine sidecar) | Phase 1 |
| Windows 10/11 | Desktop app | Phase 1 |
| Linux (.deb / .rpm / AppImage) | Desktop app | Phase 1 |
| Any browser | Self-hosted web mode (`kubebay serve`) | Phase 2 |
| In-cluster (Helm chart, OIDC) | Shared team dashboard | Phase 2 |
| Mobile (iOS/Android) | Read-only triage via responsive web first; native deferred — see [PRD §Platforms](docs/PRODUCT_REQUIREMENTS.md#platforms) | Phase 4 |

## Getting started

Not yet — Kubebay is in the architecture/documentation phase. See the [Roadmap](docs/ROADMAP.md).
Once Phase 0 lands this will become:

```bash
brew install kubebay/tap/kubebay   # planned
kubebay                             # opens the app
```

## Contributing

Repository scaffolding begins at Phase 0 kickoff. Until then, discussion happens through issues
on design docs. All docs are living documents — propose changes via PR.
