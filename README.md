# Kubebay

<div align="center">

[![CI](https://github.com/RajaSardar/kubebay/actions/workflows/ci.yml/badge.svg)](https://github.com/RajaSardar/kubebay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-41c98e.svg)](LICENSE)
[![Go](https://img.shields.io/badge/Go-1.22%2B-5b8def.svg)](https://go.dev)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ef5f68.svg)](CONTRIBUTING.md)

**A bay is where ships anchor safely. Kubebay is where your clusters come to rest.**

A free, open-source, **local-first Kubernetes IDE** — cleaner than Lens, lighter than
Freelens, friendlier than k9s.

</div>

---

| | |
|---|---|
| **Status** | 🚧 Phase 0 — foundation working; daily-driver features landing now |
| **License** | MIT |
| **Platforms** | macOS · Windows · Linux · Web (self-hosted) |
| **Docs** | [Architecture](docs/ARCHITECTURE.md) · [Tech Stack](docs/TECH_STACK.md) · [Product Requirements](docs/PRODUCT_REQUIREMENTS.md) · [Roadmap](docs/ROADMAP.md) · [Security](SECURITY.md) |

## Why Kubebay

The Kubernetes UI landscape has a trust and quality vacuum:

- **Lens** went closed-source + subscription + mandatory accounts; telemetry phones home.
- **OpenLens** died unpatched; **Freelens** keeps it alive but Electron-heavy on an aging UX.
- **Headlamp** is well-governed but visually plain for daily-driver use.
- The official **Kubernetes Dashboard was archived** in Jan 2026.

Kubebay's answer: **one Go engine, three surfaces, zero compromises on trust or performance.**

### Principles (non-negotiable)

1. **Local-first.** No accounts, no cloud control plane, no mandatory telemetry. Opt-in only, ever.
2. **Instant by default.** Every view is a live watch stream. There are no Refresh buttons.
3. **Lightweight by contract.** Hard performance budgets (≤150 MB idle RAM, ≤1.5 s cold start,
   ≤40 MB installer) enforced in CI — see [PRD §6](docs/PRODUCT_REQUIREMENTS.md).
4. **One engine, many surfaces.** Desktop (Tauri), standalone web binary, in-cluster Helm chart.
5. **RBAC-aware everywhere.** The UI reflects what you're actually allowed to do.
6. **Keyboard-first.** Command palette drives everything; mouse optional.
7. **Truly open source.** MIT, public roadmap, no bait-and-switch.

## What's inside today

- **Go engine**: multi-cluster kubeconfig manager (hot-reload), health monitoring,
  metadata-only shared informers per `(cluster, resource)` with lazy lifecycle,
  coalescing delta broadcaster, single multiplexed WebSocket protocol v1
  (`sub` → snapshot → `sync` → live deltas), token-authed REST API, embedded SPA serving
- **Web shell**: Dusk/Dawn theme system (+ high-contrast variants) with live switching,
  icon navigation, cluster overview reading your real kubeconfig, skeleton/error/empty states

## Install

```bash
brew install rajasardar/tap/kubebay
kubebay          # serves the UI, opens your browser, prints a session token
```

Or run as a background service:

```bash
brew services start rajasardar/tap/kubebay
# UI at http://127.0.0.1:9898 — token in `brew services info rajasardar/tap/kubebay`
```

Binaries for macOS (arm64/amd64) and Linux are on the
[releases page](https://github.com/RajaSardar/kubebay/releases).

## Quick start (from source)

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay
make run          # builds SPA + engine, serves at http://127.0.0.1:9898
```

`make run` prints a one-time session token — open the URL it logs:
`http://127.0.0.1:9898/?token=…`

Prerequisites: Go ≥ 1.22, Node 20+ (`corepack enable pnpm`). Your real `~/.kube/config`
is read and hot-reloaded; nothing leaves your machine.

## Roadmap

Phase 1 lands daily-driver parity: log viewer, terminals, port-forward manager,
YAML edit+diff, metrics, command palette, packaged desktop apps (Tauri).
Then the differentiators nobody ships well: live topology, event timeline, RBAC explorer,
Helm manager, fleet dashboard, built-in MCP server + guarded AI copilot.

Full plan: [docs/ROADMAP.md](docs/ROADMAP.md).

## Contributing

Issues and PRs are welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md).
Good first issues are labeled `good first issue`. If you care about developer-tool craft,
you'll feel at home here.

## License

[MIT](LICENSE) © 2026 RajaSardar
