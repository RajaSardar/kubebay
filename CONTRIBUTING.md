# Contributing to Kubebay

Thanks for considering a contribution. This document covers the practical side: how to get a working dev environment, what a good PR looks like, and what the project is not ready for yet.

Questions? Use [GitHub Discussions](https://github.com/RajaSardar/kubebay/discussions), not issues. Issues are for tracked bugs and planned work.

For security vulnerabilities, use GitHub's private vulnerability reporting — see [SECURITY.md](SECURITY.md). Do not open public issues for security problems.

---

## Architecture Overview

Before writing code it is worth understanding the three-layer structure:

```
┌─────────────────────────────────────────┐
│  Desktop shell (Tauri 2 / Rust)         │  desktop/
│  Thin OS wrapper. Spawns the engine     │
│  as a sidecar. Handles auto-update,     │
│  OS keychain, window management.        │
└─────────────────┬───────────────────────┘
                  │ localhost WebSocket + REST
┌─────────────────▼───────────────────────┐
│  Engine (Go)                            │  engine/
│  All cluster logic lives here.          │
│  client-go informers, Helm SDK,         │
│  RBAC, logs/exec/port-forward,          │
│  metrics, SSA writes. Single binary.    │
└─────────────────┬───────────────────────┘
                  │ WS + REST (same localhost)
┌─────────────────▼───────────────────────┐
│  Frontend (React / TypeScript)          │  web/apps/shell/
│  Dumb renderer. No cluster logic.       │
│  TanStack Query for REST, custom topic  │
│  stores for WS delta streams, Zustand   │
│  for UI state. Tailwind + Radix UI.     │
└─────────────────────────────────────────┘
```

Design principle: the engine is the source of truth. The frontend renders what the engine tells it. If you are adding a feature, think hard about which layer owns it. Almost everything belongs in the engine.

Full architecture detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Stack decisions: [docs/TECH_STACK.md](docs/TECH_STACK.md). Read the protocol section (§4) before touching engine ↔ frontend communication — control frames and payload encoding must stay in sync.

---

## Project Principles

These are not aspirational — PRs that conflict with them will be closed.

1. **Local-first.** No accounts, no cloud control plane, no mandatory telemetry. A PR that adds any of these will be rejected regardless of quality.
2. **Instant by default.** No refresh buttons. Every view rides a live watch stream.
3. **Lightweight by contract.** Performance budgets in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md) are enforced by CI. If your change regresses a budget, optimize before resubmitting.
4. **RBAC-aware UI.** Never show an action the API server would deny.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Go | 1.23+ | engine |
| Node.js | LTS 20+ | build-time only |
| pnpm | 9+ | `corepack enable pnpm` or `npm i -g pnpm` |
| Rust + Cargo | stable | Tauri shell |
| Tauri prerequisites | — | [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/) |

You also need a Kubernetes cluster to test against. Use [kind](https://kind.sigs.k8s.io/):

```sh
kind create cluster --name kubebay-dev
```

**Never test against a production cluster.**

---

## Running Locally

### Engine + web (simplest)

```sh
make web-install     # pnpm install for the web workspace
make run             # build SPA + engine, serve at http://127.0.0.1:9898
```

`make run` prints a one-time session token — open the URL it logs. Your real `~/.kube/config` is read and hot-reloaded. Nothing leaves your machine.

### Engine only (fastest for backend work)

```sh
cd engine
go run ./cmd/kubebay serve
```

Binds to `127.0.0.1:9898` by default.

### Frontend only (fastest for UI work)

```sh
cd web
pnpm install
pnpm dev
```

The dev server proxies API calls to `localhost:9898`. You need the engine running separately.

### Full desktop app (Tauri)

```sh
make sync-ui                   # build SPA and embed it in the engine
make engine                    # build the Go engine binary
cp engine/bin/kubebay desktop/src-tauri/binaries/kubebay-engine-<target>
cd desktop && pnpm tauri build --debug
```

Replace `<target>` with your Rust target triple, e.g. `aarch64-apple-darwin` on Apple Silicon.

### Useful make targets

| Target | What it does |
|---|---|
| `make run` | Build SPA + engine, serve with hot reload |
| `make engine` | Build the Go engine binary only |
| `make sync-ui` | Build SPA and copy dist into engine static embed |
| `make web-install` | `pnpm install` for the web workspace |
| `make test` | Engine unit tests + web typecheck |

---

## Before Opening a PR

Run checks locally before pushing:

```sh
# Engine
cd engine
go build ./...
go vet ./...
go test ./...

# Frontend
cd web
pnpm typecheck
pnpm lint
pnpm build
```

Also:
- Test against a real cluster (kind is fine). Describe what you tested in the PR.
- If your change touches the informer path, a hot rendering path, or any stream, verify the performance budgets in [docs/PRODUCT_REQUIREMENTS.md](docs/PRODUCT_REQUIREMENTS.md) are unaffected.
- If your change touches an architectural decision, update or add an ADR in `docs/adr/`.

---

## Pull Request Guidelines

- **One PR, one concern.** Do not bundle a refactor with a feature. If you find something broken while working on something else, fix it in a separate PR.
- **Conventional Commits style:** `feat:`, `fix:`, `docs:`, `refactor:`, `perf:`, etc.
- **Link related issues.** Use `Fixes #123` in the PR body.
- **Describe your testing.** What cluster, what scenario, what you verified.
- **Keep it reviewable.** PRs over ~500 lines of diff should usually be broken up.
- **New user-facing behavior** needs a docs update in the same PR.
- **Screenshots or GIFs** for anything visual.
- **CI must be green.** Do not open a PR with failing checks unless you have a specific question about the failure.

The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) has a checklist — fill it out.

---

## Reporting Bugs and Proposing Features

Use GitHub Issues with the provided templates. Good first issues are labeled [`good first issue`](https://github.com/RajaSardar/kubebay/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

For larger feature proposals, open a GitHub Discussion first. This avoids writing code that conflicts with something already planned.

---

## Code of Conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md) (Contributor Covenant v2.1).

---

## What Not to Contribute Yet

These are areas where PRs will be politely closed. It is not a judgment on the ideas — they are just not the right focus at this stage of the project.

**Additional themes.** The design system (Dusk/Dawn + high-contrast pair) needs to stabilize before new themes make sense. PRs adding a third theme will be deferred.

**i18n / localization.** UI strings are not yet extracted into an i18n layer. Adding translations now creates maintenance overhead before the product is stable. This is planned for a later phase.

**Windows and Linux platform parity work.** The primary dev and test environment is macOS. Platform-specific fixes are welcome if you can test them properly, but do not send untested platform code. Cross-platform parity is Phase 1 work and will be explicitly tracked when that milestone opens.

**Electron port.** Electron is documented as a fallback in the architecture, but it is not a current target.

**Plugin system contributions.** The plugin host (WASM/wazero) is Phase 3. The APIs are not stable yet.

**AI/LLM features.** The MCP server and AI copilot are also Phase 3. Same reasoning — the interfaces are not settled.

If you are unsure whether your idea is in scope, open a Discussion before writing code.

---

## Licensing

By contributing you agree your contributions are licensed under the MIT License covering this project.

---

## Governance

See [GOVERNANCE.md](GOVERNANCE.md) for how decisions are made and how you can earn a larger role in the project.
