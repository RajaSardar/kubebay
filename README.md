<div align="center">

# Kubebay

**A bay is where ships anchor safely. Kubebay is where your clusters come to rest.**

A free, open-source, **local-first Kubernetes IDE** — cleaner than Lens, lighter than Freelens, friendlier than k9s.

[![CI](https://github.com/RajaSardar/kubebay/actions/workflows/ci.yml/badge.svg)](https://github.com/RajaSardar/kubebay/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-41c98e.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/RajaSardar/kubebay?color=22d3ee)](https://github.com/RajaSardar/kubebay/releases/latest)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ef5f68.svg)](CONTRIBUTING.md)

</div>

---

## Download

**[→ Latest release](https://github.com/RajaSardar/kubebay/releases/latest)**

### Desktop app (v0.4.0+)

Native macOS app — arm64 universal build:

**One-line installer (macOS):**
```bash
brew install rajasardar/tap/kubebay
```

Or download directly from [Latest Release](https://github.com/RajaSardar/kubebay/releases/latest) and extract to `/Applications`.

> **Gatekeeper quarantine:** If you see "Kubebay Not Opened", run:
> ```bash
> xattr -dr com.apple.quarantine /Applications/Kubebay.app
> ```
> Or: **System Settings → Privacy & Security → Open Anyway**.

### CLI engine (all platforms, v0.4.0+)

Headless engine — serves the web UI, you bring the browser. Download from [Latest Release](https://github.com/RajaSardar/kubebay/releases/latest).

### Homebrew (macOS)

Install the desktop app:
```bash
brew install rajasardar/tap/kubebay
# Launch from Applications or Spotlight, or run: open -a Kubebay
```

Or run the CLI engine as a background service:
```bash
brew services start rajasardar/tap/kubebay
# UI at http://127.0.0.1:9898
```

---

## How to use

**1. Run the engine**

```bash
# After extracting the archive:
./kubebay
```

The engine prints its address and where it wrote this session's token:

```
kubebay engine listening addr=http://127.0.0.1:9898
session token written path=~/.config/kubebay/session-token
```

**2. Open `http://127.0.0.1:9898` in your browser** and paste that token when
asked. The desktop app does this for you — it reads the file and never shows
you a token at all.

**3. Connect your clusters** — Kubebay reads `~/.kube/config` automatically and hot-reloads when it changes. No setup required.

### What you get

- **Fleet view** — live health across all clusters: node ready counts, pod counts, warnings
- **All standard K8s resources** — Workloads, Config, Network, Storage, Access Control, Admission webhooks, Cluster internals — all live-streaming from the watch API
- **CRD browser** — auto-discovers and lists every custom resource on the connected cluster
- **RBAC explorer** — visual permission matrix with self-check
- **Helm manager** — browse releases, inspect chart versions
- **Port-forward manager** — create and track port-forwards without keeping a terminal open
- **Event timeline** — chronological event stream with warning filter
- **Topology view** — namespace-scoped pod/service/deployment graph
- **Command palette** — `⌘K` to jump anywhere
- **Theme system** — Dusk/Dawn + high-contrast; persists across restarts

---

## Why Kubebay

The Kubernetes UI landscape has a trust and quality vacuum:

- **Lens** went closed-source + subscription + mandatory accounts
- **OpenLens** died unpatched; **Freelens** keeps it alive but Electron-heavy
- **Headlamp** is well-governed but visually plain for daily-driver use
- The official **Kubernetes Dashboard was archived** in Jan 2026

Kubebay's answer: **one Go engine, three surfaces, zero compromises on trust or performance.**

### Principles

1. **Local-first.** No accounts, no cloud control plane, no mandatory telemetry. Opt-in only, ever.
2. **Instant by default.** Every view is a live watch stream. No Refresh buttons.
3. **Lightweight by contract.** ≤150 MB idle RAM · ≤1.5 s cold start · ≤40 MB installer — enforced in CI.
4. **One engine, many surfaces.** Desktop (Tauri), standalone web binary, in-cluster Helm chart.
5. **RBAC-aware everywhere.** The UI reflects what you're actually allowed to do.
6. **Keyboard-first.** Command palette drives everything; mouse optional.
7. **Truly open source.** MIT, public roadmap, no bait-and-switch.

---

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan.

Coming next: multi-pod log streaming, YAML edit+diff, network policy visualization, app-label workload grouping, in-cluster Helm chart deployment.

---

## Contributing / Building from source

See **[CONTRIBUTING.md](CONTRIBUTING.md)** — it covers dev setup, repo layout, PR guidelines, and how to build from source.

---

## License

[MIT](LICENSE) © 2026 RajaSardar
