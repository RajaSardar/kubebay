# ADR 0002: Move the engine to the Helm 4 SDK, which means Go 1.26

- **Status:** Proposed. It needs a maintainer's decision, because it raises the Go needed to build Kubebay.
- **Date:** 2026-10-14
- **Backlog:** KB-12, "evaluate Helm 4 separately"

## Context

The Helm manager (`engine/internal/httpapi/helm.go` and `helm_repo.go`, about 620 lines) uses the Helm 3 SDK, pinned at **v3.19.5**.

That version is no longer maintained:

- **v3.19.5 is the last patch of 3.19,** released 2026-01-14. Helm patches only its newest minor, and fixes went on to 3.20.x (last 2026-04-09) and 3.21.x (last 2026-08-13).
- **Helm 4.0 went GA on 2025-11-12.** Helm 3 is in its end-of-life window.
  - Bug fixes ended 2026-07-08.
  - **v3.22.0** (2026-09-09) is the last Helm 3 release, and it only updates the Kubernetes client libraries.
  - **Security fixes end 2027-02-10.** After that, Helm 3 gets nothing.

  Source: the [Helm 3 end-of-life post](https://helm.sh/blog/helm-v3-end-of-life).

Every Helm newer than Kubebay's needs a newer Go. Kubebay builds with Go 1.24, and `make build` uses `GOTOOLCHAIN=local`:

| Module | `go` directive | client-go |
|---|---|---|
| `helm.sh/helm/v3` v3.19.5 (today) | 1.24.0 | v0.34.2 |
| `helm.sh/helm/v3` v3.20.0 | 1.25.0 | v0.35.0 |
| `helm.sh/helm/v3` v3.22.0 (last Helm 3) | 1.26.0 | v0.37.0 |
| `helm.sh/helm/v4` v4.3.0 (latest, 2026-09-09) | 1.26.0 | v0.37.0 |

These figures come from the modules' `go.mod` files on proxy.golang.org, checked 2026-10-14.

## What Helm 4 changes for Kubebay

I read the v4.3.0 source against the nine calls Kubebay makes: `Configuration.Init`, `NewList`, `NewHistory`, `NewGet`, `NewGetValues`, `NewRollback`, `NewUninstall`, `NewInstall` and `NewUpgrade`.

- **Import paths:**
  - `pkg/release` becomes `pkg/release/v1`.
  - `pkg/repo` becomes `pkg/repo/v1`.
  - Charts live in `pkg/chart/v2`, and `pkg/chart/loader` stays.
  - `pkg/action`, `pkg/cli`, `pkg/getter` and `pkg/storage/driver` keep their names under `helm.sh/helm/v4`.
- **Types:**
  - `Install.Run`, `Upgrade.Run` and friends take a `Charter` interface and return a `Releaser` interface. Kubebay then asserts `*v1.Release`.
  - `Configuration.Init` drops its log-function argument. Logging goes through `slog`, so `helmSilentLog` becomes a discarding `slog` handler.
- **Apply method:** new installs use server-side apply by default (`Install.ServerSideApply: true`).
  - Upgrades default to `"auto"`, which keeps the method the release was created with. Releases installed by Helm 3 stay client-side.
  - The release records it in a new `apply_method` field. Release storage is otherwise unchanged (Secrets of type `helm.sh/release.v1`, `owner=helm`).
  - Helm 3 ignores the new field, so each version can read releases the other wrote.
- **Waiting:** `--wait` uses kstatus and needs the `watch` verb. Kubebay doesn't wait today (it relies on timeouts), so nothing changes. If it ever waits, RBAC needs `watch`.
- **Chart format:** charts with `apiVersion: v2` load as before.

## Options

1. **Stay on v3.19.5 with Go 1.24.** Nothing to do now, but the Helm code gets no fixes and drops out of Helm's support entirely on 2027-02-10. Not tenable past then.
2. **Go 1.26 and Helm v3.22.** The SDK API doesn't change. It's supported until 2027-02-10, and then this decision comes back with no further Helm 3 to move to.
3. **Go 1.26 and Helm v4.3 (proposed).** This is the same Go and client-go change as option 2, plus a small API migration. It lands on the line Helm will keep maintaining.

## Decision (proposed)

Option 3: one PR that does the following.

- **Go and Kubernetes libraries:** raise `go.mod` to `go 1.26`. That covers CI and `setup-go`, the Docker and release builds, the README and CONTRIBUTING prerequisites, and the CHANGELOG note. It also bumps `k8s.io/*` to v0.37 together with `helm.sh/helm/v4` v4.3.x.
- **Helm calls in `internal/httpapi/helm.go`:**
  - Port the nine calls.
  - Keep Helm 4's defaults: server-side apply for new installs, `"auto"` for upgrades.
  - Release summaries show the apply method.
- **Tests:**
  - `helm_test.go` keeps its tests.
  - A live integration test (kind) installs, upgrades, rolls back and uninstalls a chart through the engine, then reads a release written by Helm 3.
  - The integration suite already runs on Kubernetes 1.29, 1.34 and 1.37 (KB-12), which covers client-go v0.37 against the oldest supported cluster.

The deadline is 2027-02-10. Doing it before then also brings the Kubernetes 1.35+ libraries the KB-12 bump stopped short of.

## Consequences

- **Builds:** contributors and `make build` need Go 1.26. Go 1.24 has been out of support since Go 1.26 shipped, so this also puts the engine back on a supported compiler.
- **Mixing Helm 3 and Kubebay on one release:** a release Kubebay installs is server-side applied. If someone later upgrades it with a Helm 3 CLI, that upgrade is client-side, and the field managers on the objects change hands. It still works, and both tools read the release. Helm 3 is end-of-life in four months, so we follow Helm 4's defaults rather than pin client-side apply. The Helm page shows each release's apply method.
- **Size:** about a day for the port and its tests. Most of the risk is in client-go v0.34 → v0.37, which the three-version integration matrix is there to catch.
