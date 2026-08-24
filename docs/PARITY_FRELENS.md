# Kubebay ↔ Freelens Parity Matrix

> Living checklist comparing against Freelens v1.10.x (July 2026) feature set.
> Sources: freelensapp/freelens releases page + issue tracker (refs inline).

## ✅ At parity or better

| Feature | Notes |
|---|---|
| Multi-cluster mgmt, kubeconfig hot-reload | |
| Resource-tree sidebar, all core kinds | |
| Custom Resources auto-discovery | |
| Logs: tail/follow/previous/filter/download/severity | split-view multi-pod = pending |
| Terminal exec w/ shell fallback + distroless UX | |
| Port-forward manager | auto-port chips added this release |
| YAML edit + SSA + dry-run diff | |
| Metrics CPU/Mem pods + nodes | history graphs = pending (Prometheus) |
| Helm releases/history/rollback/values-edit/marketplace install | |
| Node shell (Bottlerocket/Windows variants pending) | |
| Event timeline (superset of Events page) | |
| Topology graph | Kubebay-only (Octant successor) |
| Fleet dashboard · RBAC who-can-what · Themes+HC · Web mode · Tauri footprint | Kubebay-only |

## ✅ Recently closed (this batch)

| Gap | Status |
|---|---|
| Kubeconfig catalog management | ✅ Settings → Kubeconfig sources (add/remove + **isolated mode**: only listed files, default/KUBECONFIG ignored) |
| Prometheus history graphs + time ranges | ✅ Settings → Prometheus URL; pod drawer Graphs tab (CPU/mem per container, 15m/1h/6h/24h) via engine query_range proxy |

## 🔧 Shipping this release

| Gap | Freelens ref | Implementation |
|---|---|---|
| CronJob **Trigger** + Suspend/Resume | since v1.8 (#1569) | `/api/action/trigger-cronjob`, `suspend-cronjob` |
| Node **cordon / drain** | v1.0+ (K8s≥1.31) | `/api/action/cordon`, `/api/action/drain` (Eviction API, PDB-aware) |
| `default-container` annotation respected | #2098/#1557 | PodPanel container preselect |
| One-click PF from pod ports | Lens UX | PodPanel forward chips |
| Pod rendered Summary (env/volumes/probes/status/scheduler) | core Lens | PodPanel Summary tab |
| Endpoints + EndpointSlices tables | Network group | DEFS additions |
| ValidatingAdmissionPolicy(+Binding) tables | #2089 | DEFS additions |

## 🖥️ UI Surface Gap Analysis (deep code audit vs Freelens v1.10.x)

Based on source-level analysis of Freelens' sidebar registration, resource views, and detail drawers.

### Sidebar structure comparison

| Freelens sidebar section | Kubebay equivalent | Status |
|---|---|---|
| **Favorites** (pin, drag-reorder, overview page, persistent) | — | ❌ MISSING |
| **Workloads > Overview** (status summary cards, counts per kind, ratio bars) | ✅ WorkloadsOverview page | ✅ |
| Workloads > Pods / Deployments / STS / DS / Jobs / CronJobs | ✅ all present | ✅ |
| **Configuration > ConfigMaps / Secrets / Resource Quotas / Limit Ranges / HPA / PDB** | ✅ all present | ✅ |
| **Network > Services / Endpoints / EndpointSlices / Ingresses / Network Policies** | ✅ all present | ✅ |
| **Storage > PVCs / PVs / Storage Classes** | ✅ all present | ✅ |
| **Namespaces** | ✅ | ✅ |
| **Events** (compact, embeddable in resource drawers) | Timeline (different UX, arguably better) | ⚠️ different |
| **Custom Resources > Definitions** (CRD list page, group filter, click to instances) | Dynamic sidebar from discovery but **no CRD definitions list page** | ⚠️ partial |
| **Access Control > SA / Roles / CR / RB / CRB** | ✅ all present + RBAC explorer (superset) | ✅ |
| **Apps > Helm** (releases + marketplace) | ✅ | ✅ |
| **Nodes** | ✅ | ✅ |

### Resource list features

| Freelens feature | Kubebay | Status |
|---|---|---|
| Multi-namespace chip filter (multi-select, searchable) | Single text input | ❌ |
| Column sorting (click header) | ✅ all resource tables | ✅ |
| Column resizing (drag) | Not implemented | ❌ |
| Virtual scrolling (large lists) | TanStack Virtual (skeleton only, not wired to tables) | ⚠️ partial |
| Row context menu (right-click: edit/shell/logs/delete/PF/scale) | Row click → drawer only | ❌ |
| Line progress bars for CPU/Mem in lists | Numbers only | ❌ |
| Quick-action icon columns (logs icon, terminal icon, menu icon) | Row click → drawer tabs | ⚠️ different |
| Force delete / force finalize | ✅ (just added) | ✅ |
| Additional hidden-by-default columns (pod IP, QoS, node, controlled-by) | Not implemented | ❌ |

### Resource detail views (drawers)

| Freelens detail feature | Kubebay | Status |
|---|---|---|
| **Pod details**: env vars, volumes, probes, conditions, container status, scheduler name, QoS, node link, IP | YAML only | ❌ **BIGGEST GAP** |
| **Node details**: conditions, taints, capacity/allocatable, pod list on node, cloud provider ID, OS/arch/kernel/runtime | YAML + shell only | ❌ |
| **Service details**: endpoints, session affinity, traffic policies, external IPs, port mappings | YAML only | ❌ |
| **CronJob details**: job history, active jobs count, suspend toggle | ✅ (trigger/suspend in ActionsBar) | ✅ |
| **CRD details**: names, scope, printer columns, OpenAPI schema in Monaco | — | ❌ |
| **Events embedded in resource drawers** (filtered by parent object) | — | ❌ |
| **Deployment details**: conditions, strategy, revision history | — | ❌ |
| YAML editor with SSA + diff | ✅ | ✅ |
| Terminal exec | ✅ | ✅ |
| Logs (multi-container, follow, previous, severity, download) | ✅ | ✅ |
| Prometheus graphs in pod drawer | ✅ (Kubebay-only) | ✅ |
| Resize resources in-place | ✅ (just added) | ✅ |

### Cluster overview

| Freelens feature | Kubebay | Status |
|---|---|---|
| **Cluster overview page** — CPU/Memory bar charts, node count, workload counts, time-range selector | — | ❌ **BIG GAP** |
| Fleet dashboard (multi-cluster) | ✅ (Kubebay-only) | ✅ |
| Topology | ✅ (Kubebay-only) | ✅ |

## 📋 Documented pending (ordered)

1. **Force delete / force finalize** (#1147) — gracePeriod 0 + finalizers patch
2. **Pod resize resources** (#1805/#1840) — patch containers.resources live
3. **Nodes extra columns**: instance-type/node-group/capacity/pods-count overlay (#2097)
4. **Command palette depth**: port-forwards + cluster-switch entries (#1330)
5. **SOCKS5/bastion proxies for exec/PF upgrades** (#2092) — engine transport work
6. **Attach** (vs exec) action; default-container also for attach
7. Multi-pod split log view; log wrap/timestamp toggles persistence
8. Extensions API + marketplace UI (Phase 3 WASM plan supersedes)
