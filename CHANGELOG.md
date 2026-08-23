# Changelog

All notable changes to Kubebay are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/) once v1.0 is reached (pre-1.0: minor = breaking, patch = features/fixes).

## [Unreleased]

### Added
- Live pod metrics: `/api/metrics/pods` via the Kubernetes Metrics API; CPU and Memory columns in the Workloads table (15 s refresh)
- Event Timeline view: chronological cluster story streamed live over `v1/events`, warning-only filter, message/reason/object search, occurrence counts
- Full-object subscription mode (`mode: "full"`) via dynamic shared informers, alongside metadata-only mode
- Workloads view: live Pod table streaming over the WebSocket (ready ratio, derived status incl. CrashLoopBackOff/ImagePullBackOff, restarts, age) with cluster selector and client-side filtering
- Integration suite proving the live delta-stream round-trip (snapshot → add → delete) against a real API server; kind cluster wired into CI
- Go engine core: multi-context kubeconfig manager with file-watch hot reload and cluster health loop
- Delta-stream protocol v1 over a single multiplexed WebSocket — JSON control frames (`sub`/`unsub`/`resync`/`ping`), MessagePack data frames (`begin`/`items`/`sync`/`delta`)
- Shared metadata-only informer pool per `(cluster, resource)` with lazy start, refcounted subscriptions, TTL eviction, resync=0
- Coalescing broadcaster (latest-state-wins per key, 16 ms flush) with bounded backpressure
- Token-authed REST API (`/api/healthz`, `/api/clusters`) and embedded SPA serving from the single engine binary
- Web shell: Dusk/Dawn theme system (+high-contrast variants) driven by design tokens, live theme switching, icon navigation, overview dashboard reading real kubeconfigs, skeleton/error/empty states
- CI: Go build/vet/test and pnpm typecheck/build pipelines
