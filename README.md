<div align="center">

# Kubebay

**A bay is where ships anchor safely. Kubebay is where your clusters come to rest.**

A free, **local-first Kubernetes IDE** with its source in the open — cleaner than Lens, friendlier than k9s.

[![CI](https://github.com/RajaSardar/kubebay/actions/workflows/ci.yml/badge.svg)](https://github.com/RajaSardar/kubebay/actions/workflows/ci.yml)
[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-41c98e.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/RajaSardar/kubebay?color=22d3ee)](https://github.com/RajaSardar/kubebay/releases/latest)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ef5f68.svg)](CONTRIBUTING.md)

<br/>

<img src="docs/launch/media/kubebay-tour.gif" alt="Kubebay tour: open a cluster, the Overview flags a crash-looping deployment, SPOF Radar lists single points of failure, RBAC traces an attack path, the NetworkPolicy matrix shows who can reach whom" width="860">

<sub>Kubebay v0.7.0 on a demo cluster. The workloads and their problems are synthetic.</sub>

</div>

---

## Install

Every download is on the **[latest release](https://github.com/RajaSardar/kubebay/releases/latest)**. Kubebay comes as a desktop app, as the engine on its own (one binary that serves the same app to your browser), and as a Helm chart for a cluster. The [install guide](https://kubebay.sardar.dev/docs/install/) has every option.

### macOS

The desktop app, a universal build for Apple Silicon and Intel:

```bash
curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install-mac.sh | bash
```

The script checks the `.dmg` against the release's SHA-256 (and its cosign signature when `cosign` is installed) before it installs. Or download `Kubebay_<version>_universal.dmg` and drag Kubebay to Applications. If macOS says **"Kubebay" Not Opened**, use **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/Kubebay.app`.

Homebrew installs the engine, not the desktop app: `brew install rajasardar/tap/kubebay`, and `brew services start rajasardar/tap/kubebay` runs it in the background.

### Linux (Ubuntu, Debian and others)

The desktop app, x86_64:

```bash
curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install.sh | sh -s -- --desktop
```

Where `apt` exists it installs the `.deb` with apt, which brings in WebKitGTK; elsewhere it installs the AppImage. The engine on its own, for x86_64 and ARM64 (servers, Raspberry Pi, Graviton):

```bash
curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install.sh | sh
```

The script checks every download against the release's SHA-256 before it installs, and works with `wget -qO- <URL> | sh` too. By hand, install the `.deb` with apt (`dpkg` alone leaves its dependencies missing):

```bash
sudo apt install ./Kubebay_<version>_amd64.deb
```

The AppImage needs FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04 (`libfuse2` on 22.04). There's no ARM64 desktop app; use the engine.

### Windows

Download and run `Kubebay_<version>_x64-setup.exe`, for x86_64. The engine is `kubebay-windows-amd64.tar.gz`.

> The Windows and Linux desktop apps are **Preview**. CI builds them on every change, launches them, and fails unless the engine starts and the UI paints ([KB-14](docs/BACKLOG.md)). No release has been tested by hand on either yet. The label comes off after one has.

### Docker

```bash
docker run -d --name kubebay -p 9898:9898 \
  -v ~/.kube:/home/nonroot/.kube:ro ghcr.io/rajasardar/kubebay:latest
```

The token is in `docker logs kubebay`.

### In a cluster (Helm)

```bash
git clone https://github.com/RajaSardar/kubebay
helm install kubebay ./kubebay/charts/kubebay --namespace kubebay --create-namespace
```

The chart's values cover ingress, OIDC sign-in, TLS and resources. See [In a cluster](https://kubebay.sardar.dev/docs/install/#in-a-cluster).

### Build from source

You need Go 1.26 or later and Node 20 or later (`corepack enable pnpm`):

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay
make run    # builds the app and the engine, serves http://127.0.0.1:9898
```

The desktop app also needs Rust, and on Linux the WebKitGTK headers (`sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf`); then `make desktop`. [CONTRIBUTING.md](CONTRIBUTING.md) has the rest.

---

## How to use

**1. Run the engine**

```bash
kubebay    # or ./kubebay in the extracted archive
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
- **OpenLens** died unpatched; **Freelens** keeps it alive on the same Electron codebase
- **Headlamp** is well-governed but visually plain for daily-driver use
- The official **Kubernetes Dashboard was archived** in Jan 2026

Kubebay's answer: **one Go engine, three surfaces, zero compromises on trust or performance.**

### Principles

1. **Local-first.** No accounts, no cloud control plane, no mandatory telemetry. Opt-in only, ever.
2. **Instant by default.** Every view is a live watch stream. No Refresh buttons.
3. **Lightweight by design.** A Go engine in a Tauri shell, not Electron. The budgets are ≤150 MB idle RAM and ≤1.5 s cold start ([PRD §6](docs/PRODUCT_REQUIREMENTS.md#6-performance-budgets)). CI measures the engine and the web shell against them on every PR and fails the build on a budget over; the desktop app's own memory isn't measured in CI yet ([how](docs/PERFORMANCE.md)). The v0.6.0 installers are 19 MB (Windows), 27 MB (.deb), 53 MB (universal macOS DMG) and 102 MB (AppImage).
4. **One engine, many surfaces.** Desktop (Tauri), standalone web binary, in-cluster Helm chart.
5. **RBAC-aware everywhere.** The UI reflects what you're actually allowed to do.
6. **Keyboard-first.** Command palette drives everything; mouse optional.
7. **Free to use, source in the open.** Free for everyone, at work too, with no account and no feature limits. Public roadmap. The code is public under the Functional Source License, and each release becomes MIT two years after it ships ([License](#license)).

---

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full plan.

Coming next: multi-pod log streaming, YAML edit+diff, network policy visualization, app-label workload grouping, in-cluster Helm chart deployment.

---

## Contributing / Building from source

See **[CONTRIBUTING.md](CONTRIBUTING.md)** — it covers dev setup, repo layout, PR guidelines, and how to build from source.

---

## License

Kubebay is **fair source** under the [Functional Source License, Version 1.1, MIT Future License](LICENSE) (`FSL-1.1-MIT`), © 2026 RajaSardar, from v0.8.0 on.

What that means in practice:

- **Free for everyone to use**, including inside your company, for any internal purpose. No account, no licence key, no feature limits.
- **Read it, change it, build it, share it.** You can fork it, patch it, and redistribute it with the licence included.
- **The one thing you can't do:** make Kubebay available to others in a commercial product or service that substitutes for it or offers substantially the same functionality. In short, don't sell it, rebrand it, or host it as a paid service.
- **Each release becomes MIT two years after it ships.** The licence grants that in advance, irrevocably.

**v0.7.10 and earlier stay MIT**, as they were released. The reasons for the change are in [ADR 0006](docs/adr/0006-licence-fair-source.md). This is a plain-language summary; the [LICENSE](LICENSE) is what applies.
