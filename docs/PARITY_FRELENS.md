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

## 📋 Documented pending (ordered)

1. **Force delete / force finalize** (#1147) — gracePeriod 0 + finalizers patch
2. **Pod resize resources** (#1805/#1840) — patch containers.resources live
3. **Nodes extra columns**: instance-type/node-group/capacity/pods-count overlay (#2097)
4. **Command palette depth**: port-forwards + cluster-switch entries (#1330)
5. **SOCKS5/bastion proxies for exec/PF upgrades** (#2092) — engine transport work
6. **Attach** (vs exec) action; default-container also for attach
7. Multi-pod split log view; log wrap/timestamp toggles persistence
8. Extensions API + marketplace UI (Phase 3 WASM plan supersedes)
