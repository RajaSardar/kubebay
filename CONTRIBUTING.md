# Contributing to Kubebay

Thanks for helping build the Kubernetes IDE that should have existed years ago.
This document covers everything from building from source to getting a PR merged.

## Code of Conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Building from source

**Prerequisites:** Go ≥ 1.22, Node 20+ (`corepack enable pnpm`).

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay

make web-install     # pnpm install for the workspace
make run             # build SPA + engine, serve at http://127.0.0.1:9898
```

`make run` prints a one-time session token — open the URL it logs:

```
http://127.0.0.1:9898/?token=…
```

Your real `~/.kube/config` is read and hot-reloaded automatically. Nothing leaves your machine.

### Desktop app (Tauri)

Additional prerequisites: [Rust](https://rustup.rs), [Tauri prerequisites for your OS](https://tauri.app/start/prerequisites/).

```bash
make sync-ui                   # build SPA and embed it in the engine
make engine                    # build the Go engine binary
cp engine/bin/kubebay desktop/src-tauri/binaries/kubebay-engine-<target>
cd desktop && pnpm tauri build --debug
# App bundle: desktop/src-tauri/target/debug/bundle/
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

## Repository layout

```
engine/   Go module — clusters, informer pool, delta-stream hub, REST+WS API
web/      pnpm workspace — apps/shell (SPA) + packages/ui (design system)
desktop/  Tauri shell — wraps the engine as a sidecar, builds the .app/.exe
docs/     architecture, tech stack, product requirements, roadmap
e2e/      Playwright E2E suites
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching the engine, especially
§4 (protocol) — client and server frames must stay in lockstep.

---

## Project principles (read before opening a PR)

1. **Local-first** — no accounts, no cloud control plane, no mandatory telemetry. A PR that
   adds any of these will be rejected regardless of quality.
2. **Instant by default** — no refresh buttons; every view rides a live watch stream.
3. **Lightweight by contract** — performance budgets in
   [docs/PRODUCT_REQUIREMENTS.md §6](docs/PRODUCT_REQUIREMENTS.md) are CI-enforced. If your
   change regresses a budget, the PR fails — optimize before resubmitting.
4. **RBAC-aware UI** — never show an action the API server would deny.

---

## Pull requests

- Keep PRs focused — one feature or fix per PR.
- Conventional Commits style: `feat:`, `fix:`, `docs:`, `refactor:`, etc.
- Every PR must pass:
  - `go build ./... && go vet ./... && go test ./...` (in `engine/`)
  - `pnpm typecheck && pnpm build` (in `web/`)
- New user-facing behavior needs a docs update in the same PR.
- Screenshots or GIFs for anything visual — we care about craft.

## Reporting bugs & proposing features

Use GitHub Issues with the provided templates. For security vulnerabilities use GitHub's
private vulnerability reporting — see [SECURITY.md](SECURITY.md). Do not open public
issues for security problems.

Good-first-issue tickets are labeled [`good first issue`](https://github.com/RajaSardar/kubebay/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).

## Licensing

By contributing you agree your contributions are licensed under the MIT License covering
the project.
