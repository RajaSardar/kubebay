---
name: Kubebay project current state
description: v0.2.0 released; stream cache for instant tab navigation, pod terminal tab, Helm error fixes completed
type: project
---

Current released version: v0.2.0 (2026-09-16).

**Recent completion (this session)**:
- ✅ Stream cache module-level implementation — zero-flash tab navigation via pre-warmed Map entries
- ✅ Pod terminal tab in GenericDrawer — exec directly into any pod container, multi-container selector
- ✅ QueryClient `staleTime: 60s` bump for metadata queries (CRDs, APIs)
- ✅ Helm error message transparency — show actual backend errors, not generic "is cluster reachable?"
- ✅ Missing `/api/helm/upgrade` route registered

**Architecture patterns established**:
- Stream cache pattern: module-level Map survives React unmount/remount, TTL-based eviction, cluster-scoped cleanup on switch
- Query key factory: `lib/queryKeys.ts` with `QK.*` helpers, `STALE`/`GC` constants — all cluster-scoped queries keyed by `[cluster, type]` for efficient context-switch invalidation
- Pod drawer extensions: PodTab type with terminal, events, yaml; container selector for multi-container pods

**How to apply** (future features):
- WebSocket streaming UI: use stream cache pattern for instant re-navigation
- New API SDKs (Prometheus, ArgoCD, etc.): show actual errors, not fallbacks
- Always register routes in server.go when adding handler functions
- Query keys must include cluster ID for multi-cluster context-switch correctness
