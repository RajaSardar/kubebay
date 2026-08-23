# Contributing to Kubebay

Thanks for helping build the Kubernetes IDE that should have existed years ago.
This document gets you from clone to merged PR.

## Code of Conduct

By participating you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Project principles (read first)

1. **Local-first** — no accounts, no cloud control plane, no mandatory telemetry. A PR that
   adds any of these will be rejected regardless of quality.
2. **Instant by default** — no refresh buttons; every view rides a live stream.
3. **Lightweight by contract** — performance budgets in
   [docs/PRODUCT_REQUIREMENTS.md §6](docs/PRODUCT_REQUIREMENTS.md) are CI-enforced. If your
   change regresses a budget, the PR fails — optimize before resubmitting.
4. **RBAC-aware UI** — never show an action the API server would deny.

## Development setup

Prerequisites: **Go ≥ 1.22**, **Node 20+** with corepack (`corepack enable pnpm`), optional
**Docker** for kind-based E2E.

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay

make web-install     # pnpm install for the workspace
make test            # engine tests + web typecheck
make run             # build SPA, serve it from the engine, print your token URL
```

The engine reads your real `~/.kube/config` and hot-reloads on changes. It prints a session
token at startup; open the printed `http://127.0.0.1:9898/?token=…` URL.

## Repository layout

```
engine/   Go module — clusters, informer pool, delta-stream hub, REST+WS API
web/      pnpm workspace — apps/shell (SPA) + packages/ui (design system)
docs/     architecture, tech stack, product requirements, roadmap, security model
e2e/      Playwright suites (grows in Phase 0/1)
```

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching the engine, especially
§4 (protocol) — client and server frames must stay in lockstep.

## Pull requests

- Keep PRs focused; one feature or fix per PR.
- Conventional Commits style (`feat:`, `fix:`, `docs:`, `refactor:`…).
- Every PR must pass:
  - `go build ./... && go vet ./... && go test ./...` (in `engine/`)
  - `pnpm typecheck && pnpm build` (in `web/`)
- New user-facing behavior needs docs updates in the same PR.
- Screenshots/GIFs for anything visual — we care about craft.

## Reporting bugs & proposing features

Use GitHub issues with the provided templates. For security vulnerabilities use GitHub's
private vulnerability reporting — see [SECURITY.md](SECURITY.md). Do not open public issues
for security problems.

## Licensing

By contributing you agree your contributions are licensed under the MIT License covering
the project.
