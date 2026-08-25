# Changelog

All notable changes to Kubebay are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/) once v1.0 is reached (pre-1.0: minor = breaking, patch = features/fixes).

## [Unreleased]

### Added
- **Line progress bars** for CPU and Memory columns in the Pods table — visual indicator alongside numeric values
- **Multi-namespace chip filter**: searchable dropdown with checkboxes, selected namespaces shown as removable chips — replaces the single text input on all namespaced resource tables
- **Node Summary pane**: conditions w/ status dots, taints w/ effect badges, capacity/allocatable (CPU/Mem/Pods), OS/arch/kernel/runtime info, pod CIDR, provider ID, instance type/zone/region
- **Service Summary pane**: type badge, ports table (port/proto/target/nodePort), selector labels, traffic policies (internal/external), session affinity, external IPs, load-balancer ingress
- **Pod Summary pane** (the biggest visual gap vs Freelens): rendered view of pod status, conditions, per-container detail (image, ports, resources, env vars, mounts, liveness/readiness/startup probes), volumes with type+source, QoS, node, scheduler, service account — opens by default when clicking a pod
- **Workloads Overview page**: status summary cards per kind (Pods/Deployments/STS/DS/Jobs/Nodes) with live healthy/unhealthy counts, ratio bars, and quick navigation — Freelens Workloads > Overview parity
- **Endpoints + EndpointSlices** tables under Network group with endpoint-count columns
- **Column sorting** on all resource tables — click any header to sort ascending/descending
- **Force delete**: grace-0 + finalizer-stripping option on every delete confirmation (Freelens #1147 parity)
- **In-place pod resize**: Size tab in the pod drawer — patch CPU/memory requests/limits per container (K8s ≥1.33 vertical scaling)
- Nodes table: Instance-type, Zone, live Pods-count and Capacity columns
- Command palette depth: active port-forwards and cluster-switch entries (#1330 parity)
- Kubeconfig catalog manager: Settings → Kubeconfig sources with add/remove and **isolated mode** (`onlyListedKubeconfigs`) that ignores default ~/.kube/config and KUBECONFIG entirely — test clusters only, prod never listed
- Prometheus history graphs: Settings → Prometheus URL; pod drawer **Graphs** tab with per-container CPU + memory working-set over 15m/1h/6h/24h ranges, rendered via dependency-free SVG charts through the engine's `/api/prom/query_range` proxy
- Settings persistence at `~/.kubebay/settings.json` (applied at engine boot)
- Freelens-parity batch (see docs/PARITY_FRELENS.md): workload quick-actions in drawers — Scale, Rollout-restart, CronJob Trigger-now/Suspend/Resume; Node cordon/uncordon/drain via the Eviction API (PDB-aware, mirror/daemonset skipping); parity matrix doc tracking every remaining gap with upstream refs
- Helm marketplace: browse charts from your configured repositories (`~/.config/helm/repositories.yaml`), index refresh button, search, one-click install drawer with chart default-values prefill, version pin and release/namespace naming — full Lens Apps parity
- Node shell: one-click root shell on any node via ephemeral privileged busybox pod (hostPID, tolerates taints), auto-deleted when panel closes — `/api/node-shell`
- Node metrics columns (CPU/Memory) in the Nodes table via `/api/metrics/nodes`
- Exec shell fallback chain (bash → sh → ash) with manual picker; fixes exec into distroless/minimal images

### Fixed
- Feature-verification pass fixes: nil-request panic in RBAC/metrics identity helper (caught by live API battery)
- `/api/apis` discovery endpoint; sidebar now covers the full Lens surface — NetworkPolicies, HPAs, PDBs, ResourceQuotas, LimitRanges, ServiceAccounts, Roles/ClusterRoles/Bindings — plus a dynamic Custom Resources section built from API discovery (`/r/ext/:group/:version/:resource`)
- Functional ⌘K command palette: fuzzy navigation across every page and resource view

### Added
- In-cluster web mode: `--in-cluster` flag, OIDC login (authorization-code flow against any standard IdP with session cookies + logout), and per-user impersonation on every K8s access path — informer pools are keyed per identity so cluster RBAC governs streams too
- Deployment artifacts: multi-stage Dockerfile (web+UI embedded, distroless runtime), `charts/kubebay` Helm chart (SA + impersonation ClusterRole, Service, optional Ingress/TLS, OIDC values), GHCR image publish workflow (amd64+arm64)
- Helm manager: releases list (all namespaces, live status), history with two-step rollback, user-values editor (Monaco) with chart-ref/version inputs and Save-&-upgrade via install-or-upgrade resolution, deployed-manifest view, typed-confirm uninstall — Helm SDK v3 wired through per-context kubeconfig ConfigFlags
- RBAC explorer: "who can …" queries resolved locally from live Role/ClusterRole/RoleBinding/ClusterRoleBinding snapshots (subject → granting bindings), plus My-access panel running SelfSubjectAccessReviews for common verb/resource pairs
- Topology view (flagship): live owner-reference graph — Deployments → ReplicaSets → Pods, StatefulSets/DaemonSets → Pods, Service selector edges collapsed to workloads when unambiguous; namespace picker from live namespaces stream; click a pod node to open logs/terminal/YAML drawer
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
