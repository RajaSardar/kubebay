# Changelog

All notable changes to Kubebay are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[SemVer](https://semver.org/) once v1.0 is reached (pre-1.0: minor = breaking, patch = features/fixes).

## [Unreleased]

### Added
- **Shared shell components in `@kubebay/ui`**: `StatusPill` + `phaseTone()`, `Tabs`, `NavItem`/`NavSection` + `navItemClass()`, `TextField`, `Select`, `Kbd`, `PageHeader` (with `level` and `live`) and `ContextMenu`. Their styles now live in the package (#12)
- `--kb-on-danger` token in every theme for labels on danger fills (#12)
- **`Drawer` and `Modal` in `@kubebay/ui`**: the Pod, Helm release, Helm chart and resource drawers share one component that closes on Escape (not while you type in a field, the YAML editor or the terminal) and returns focus to where it was; the cluster icon picker is a `Modal` that keeps focus inside until it closes
- **`IconButton`, `SegmentedControl` and `Badge` tones `warn`/`info` in `@kubebay/ui`**: close, pop-out, star and row-menu buttons share one look and always carry an accessible label; the Settings display options and the Workloads and Network Policy view switches are keyboard-navigable radio groups; hand-written tab rows (Pod panel, Helm, cluster icon picker) use `Tabs`
- **`DataTable` and table primitives in `@kubebay/ui`**: every table in the app (resources, pods, Helm, ArgoCD, audit log, port forwards, network policies, cluster picker, cost and right-sizing panels) now shares the ResourceTable design. Also new: `EmptyState`, `InlineBanner`, `KubebayMark`
- `docs/DESIGN_SYSTEM.md` and a CLAUDE.md rule: all UI is built from `@kubebay/ui`, enforced by tests
- **Karpenter safe editing**: an Edit affordance on each NodePool card shows a blast-radius impact banner (nodes/pods/namespaces backed by the pool, spot count, and real PodDisruptionBudget coverage via Kubernetes label-selector matching) and requires typing the NodePool's name to confirm before applying any of three eviction-causing edits (shrinking `spec.limits`, lowering a disruption budget's `nodes` value, or switching `consolidationPolicy` to `WhenEmptyOrUnderutilized`)
- **KEDA ScaledObject wizard**: an "Add ScaledObject" flow in the Autoscaling tab generates a manifest for cron, CPU/memory, or Prometheus triggers, previews it with a live diff, and dry-runs/applies it — always created paused, with scale-to-zero (`minReplicaCount: 0`) gated behind typing the workload's name to confirm, and blocked outright if an HPA already targets the same workload. The Prometheus trigger suggests in-cluster Service candidates for `serverAddress` rather than reusing Kubebay's local Prometheus proxy URL, which resolves to a different address entirely

### Changed
- **Every theme meets WCAG AA**: text reads at 4.5:1 or better on every surface, status pills and button labels reach 4.5:1, and focus rings are solid and at least 3:1. Dawn HC and Dusk HC reach 7:1 for body text with 3:1 control borders. Hues are kept; only lightness moves. Visible changes: Dusk primary buttons use a dark label on cyan, Dawn's accent is a deeper blue (`#0065c9`), VS Code Dark+ uses a lighter blue (`#31a6ff`), and Nord's error red is a pale rose (`#e6c1c4`) (#12, this release)
- The shell renders every page header, toolbar input and select, keycap and sidebar link through `@kubebay/ui`, so the package is the single source of truth for that markup
- Settings theme swatches match each theme's colours
- Ghost and danger buttons match the design system everywhere (an `app.css` override had given them a weaker border and smaller text); the cluster picker's search, table, status and provider badges and row menu use the shared components; provider badges are neutral instead of hand-picked hues that failed contrast in light themes
- Cluster avatars pick black or white initials by contrast with their colour
- **"System" theme follows the OS contrast setting**: with "Increase contrast" on, it picks Dusk HC or Dawn HC
- **Pending has its own colour**: Pending pods use each theme's info hue instead of the warning orange, so they no longer read as warnings

### Fixed
- Borders, focus halos, text colour and backgrounds missing in the Network Policy view, cluster picker and cluster detail drawer: six undefined `--kb-*` variables now point at real tokens (#12)
- Cluster-picker nav highlight and engine-status dot follow the theme instead of fixed colours (#12)
- ArgoCD sync and health pills had no background or border (their colour was built as invalid CSS)
- Two notices styled with an `info-banner` class that had no CSS now render as proper banners
- Light-theme users no longer see a dark frame on launch: the saved theme is applied before first paint
- Text inputs and selects have a visible edge in every theme (3:1, WCAG 1.4.11) via a new `--kb-border-control` token; before, it measured 1.1–1.8:1
- Focus rings, selected rows and status dots stay visible in Windows High Contrast (forced colours)
- **Full design-system audit across all 12 themes** (every component rendered and measured, plus the cluster catalog and Settings in the running app):
  - Table loading states drew nothing: skeleton blocks were inline spans with no size inside table cells. They are now visible blocks on every ground
  - Pill, badge, active-segment and palette text fell below 4.5:1 on canvas, raised and inset grounds and on selected rows in up to nine themes. Tints are lighter, pill text is adjusted per theme, and Dawn, VS Code Light+, GitHub Light and Nord have a slightly deeper accent
  - Cluster avatars: the AWS preset (`#F90`) and unknown clusters showed white labels on light colours (1.9:1); inactive clusters in the strip were faded to 32%, taking labels to 1.3:1. Labels pick their colour correctly and inactive avatars are desaturated instead of faded
  - The active theme card hid its keyboard focus ring; a namespace pill on a selected row stacked a second tint; the palette's "syncing…" faded to unreadable
  - Dracula's muted text was the accent purple (looked like links); Nord's error was a pale rose indistinguishable from its success and warning; VS Code Dark+ warning sat 17° from its error
- The cluster icon picker opened half off-screen and under the sidebar: the translucent cluster strip trapped its fixed position. Modals now render into the page body
- Text that was unreadable in light themes: the CRD "ns" badge, the Normal event badge, the active CRD tree row and the active favourite used the white on-accent label colour on a pale tint; they now use the accent. A contrast test stops it recurring
- Pod history graphs use the theme's chart colours (`--kb-chart-1…5`, 3:1 on every ground) instead of one fixed palette for all 12 themes
- In Dawn and VS Code Light, the ok, warn and error colours now read at 4.5:1 on inset fields too
- Code editors use Monaco's high-contrast themes in Dawn HC and Dusk HC

## [0.1.3] — 2026-09-09

### Added
- **CRD Definitions page** (/crds) — browse all custom resources by API group, search by kind, click to view instances
- **Context menu** on resource table rows — right-click to view details, edit YAML, or delete
- **Favorites sidebar** — star any resource page, persistent across sessions, shown in sidebar when present
- **Events tab** in resource drawers — view related events for any non-node, non-service resource
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
- **Prometheus error handling**: structured JSON error with actionable "not running" banner and port-forward command hint; removed `promclient` dependency; reduced proxy timeout to 10s
- **Size tab hang**: missing `ResizePanel` import in PodPanel — caused runtime failure on the Size tab
- **Exec fallback**: extended `shouldFallback` predicate to handle `403 Forbidden` websocket handshake errors on fresh clusters, enabling SPDY fallback
- **Timeouts**: 10s backend contexts on `/api/yaml` and `/api/action/resize-pod`; 10s frontend AbortController on YAML fetch
- **Layout**: full-width pages, drawer widened to `min(820px, 75vw)`, taller table viewport, reduced padding
- **TypeScript strict fixes**: null-guards in Favorites regex match, type-safe label indexing in ResourceTable, fixed nested property access in PodSummary volumes, removed dead code across Workloads/WorkloadsOverview/EventsDrawer
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
