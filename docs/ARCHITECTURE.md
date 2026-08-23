# Kubebay Architecture

> Status: **Approved design** — this is the blueprint Phase 0 implements.
> Audience: contributors. Companion docs: [TECH_STACK](TECH_STACK.md) · [SECURITY](SECURITY.md).

---

## 1. Design Principles (architectural)

| # | Principle | Consequence |
|---|---|---|
| A1 | **The API server is the source of truth** | No shadow database. Engine caches via informers; writes go straight to the API server (Server-Side Apply). |
| A2 | **One upstream watch, N subscribers** | Shared informer per `(cluster, GVR)`. 50 open tabs cost the cluster the traffic of 1. |
| A3 | **Push, never poll** | UI state updates exclusively from a delta stream. Polling exists nowhere in the core. |
| A4 | **Lazy everything** | Informers start on first subscription, stop after TTL with zero subscribers. Memory tracks what you look at, not what exists. |
| A5 | **Generic over GVR** | CRDs are first-class via discovery + dynamic client. New kinds need zero code. |
| A6 | **Thin shell, fat engine** | All cluster logic lives in one Go binary; desktop/web shells are dumb renderers. |
| A7 | **Binary where it's hot** | High-churn streams (deltas, logs) use binary encoding; control plane stays human-readable JSON. |

## 2. System Overview

```
┌────────────────────────── Desktop (Tauri 2) ─────────────────────────────┐
│   WebView: React SPA                                                     │
│   virtualized tables · topology canvas · Monaco YAML · xterm.js          │
└───────────────△──────────────────────────────────────────────────────────┘
                │ ① single multiplexed WS (control JSON / payload msgpack)
                │ ② REST for CRUD & config
┌───────────────▽──────────────────────────────────────────────────────────┐
│ KUBEBAY ENGINE (Go, single static binary, binds 127.0.0.1)               │
│                                                                          │
│  ┌──────────────┐   ┌────────────────────────┐   ┌────────────────────┐ │
│  │ Cluster       │   │ Informer Cache Pool    │   │ Session Manager    │ │
│  │ Manager       │→ │ 1 shared informer per  │→ │ auth token, fan-out│ │
│  │ kubeconfig(s),│   │ (cluster,GVR), lazy    │   │ backpressure,      │ │
│  │ OIDC refresh, │   │ start/stop, metadata-  │   │ per-client cursors │ │
│  │ health probe  │   │ only watches           │   │                    │ │
│  └──────────────┘   └────────────────────────┘   └────────────────────┘ │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Stream Gateway: logs · exec · attach · port-forward                │  │
│  │ WebSocket v5.channel.k8s.io first → SPDY fallback (< k8s 1.31)     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────┐ ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ Helm   │ │ Metrics  │ │ RBAC      │ │ Event    │ │ Plugin Host    │  │
│  │ module │ │ adapter  │ │ inspector │ │ Timeline │ │ (WASM/wazero)  │  │
│  │        │ │ metrics- │ │ SSAR      │ │ store    │ │ + MCP server   │  │
│  │        │ │ server + │ │ cache     │ │ (ring)   │ │                │  │
│  │        │ │ Prom     │ └───────────┘ └──────────┘ └────────────────┘  │
│  └────────┘ └──────────┘                                                 │
└───────────────△──────────────────────────────────────────────────────────┘
                │ client-go: LIST/WATCH (protobuf), WS/SPDY streaming
         ┌──────┴──────┬───────────────┬───────────────┐
      Cluster A     Cluster B       Cluster C      … concurrent
```

## 3. Core Engine Components

### 3.1 Cluster Manager
- Loads all contexts from `~/.kube/config` + `$KUBECONFIG` files at startup; re-watches files for edits (add/remove context without restart).
- Maintains per-cluster: REST config, transport (TLS, proxies), OIDC token refresher (proactive refresh at T-30s), version/discovery cache (refreshed on connect + every 10 min).
- Health model: `connecting → connected → degraded (watch errors) → unreachable`, surfaced in UI as connection badge.

### 3.2 Informer Cache Pool
The heart of the system. One shared informer factory instance per cluster.

```
subscription(cluster, gvr, namespace-scope)
        │ first subscriber?
        ▼
Reflector ──LIST──▶ seed Indexer (resourceVersion RV₀)
        │
        └──WATCH(from RV₀)──▶ DeltaFIFO ──▶ Indexer ──▶ broadcaster
                                (relist on "too old" 410 Gone;
                                 consume watch bookmarks)
```

- **Scope narrowing:** list views subscribe with namespace selectors and label selectors passed through to the API server (`fieldSelector`/`labelSelector`) — never filter client-side what the API can filter server-side.
- **Metadata-only mode:** list/table views subscribe to `PartialObjectMetadata` streams; full objects are fetched lazily for detail views. On a 100k-pod cluster this is the difference between gigabytes and megabytes of resident memory.
- **Lifecycle:** refcounted subscriptions; informer torn down after `--evict-ttl` (default 5 min) with zero subscribers. Resync period = 0 (pure delta stream; resync is wasted CPU for a UI).
- **Client tuning:** QPS/burst raised modestly (e.g., 50/100), configurable per cluster for rate-limited API servers.

### 3.3 Session Manager & Delta Broadcaster
Every UI connection = one session. The broadcaster:
- Multiplexes informer events onto each session's subscribed topics.
- Applies **per-session server-side filtering** before serialization (namespace, search text? no — text filtering is client-side; structural filtering is server-side).
- Backpressure: slow clients get coalesced deltas (latest-state wins per key) rather than unbounded queues — a stalled tab can't OOM the engine.
- Snapshot semantics: on subscribe, engine dumps current Indexer contents then flips to live deltas with a `sync` marker carrying the RV — no gap, no duplicates.

### 3.4 Stream Gateway (logs / exec / attach / port-forward)
- Uses Kubernetes' standardized **WebSocket subprotocol `v5.channel.k8s.io`** (default since k8s 1.31); falls back to SPDY for older clusters automatically.
- Each interactive session (terminal, log tail) is its own channel on the client's single app-level WebSocket, tagged with a session id — browser connection limits never bite.
- Log pipeline: server-side initial tail (configurable 50–20k lines) → follow stream → framed chunks with container/pod/timestamp metadata → optional severity classification server-side (cheap regex pass) so the UI can colorize without parsing.
- Port-forward manager holds sessions independent of UI navigation; sessions survive page switches and are listed/reclaimable in a dedicated panel.

### 3.5 Feature Modules
| Module | Responsibility | Source of data |
|---|---|---|
| Helm | install/upgrade/rollback/history/values-diff; release inventory across namespaces | Helm SDK v3 (`pkg/action`), no CLI shelling |
| Metrics | CPU/memory per pod/node/container; short history ring buffer (last 15 min) for sparklines | metrics-server; Prometheus if configured (configurable URL) |
| RBAC inspector | who-can-do-what queries; RoleBinding graphs; permission checks for UI affordances | SubjectAccessReview / SelfSubjectAccessReview + cached role objects |
| Event Timeline | unified chronological event store (ring buffer per cluster, e.g. last 24h in memory) | Events informer |
| Apply/Edit | YAML validate → diff preview → Server-Side Apply; dry-run by default | discovery schema + SSA |
| Plugin Host | WASM modules (wazero) with capability-scoped imports; UI extension registry served to frontend | see SECURITY.md §Plugins |
| MCP Server | exposes read-only cluster tools/resources/prompts over stdio+HTTP for AI IDEs | same internal APIs, read-only enforcement |

## 4. Client ⇄ Engine Protocol

Single WebSocket + REST. Control frames are JSON; bulk payloads are MessagePack.

### 4.1 Frames (illustrative)

```jsonc
// C→S: subscribe to a resource stream
{ "type": "sub", "id": "s1", "cluster": "prod-eu",
  "gvr": "apps/v1/deployments", "ns": ["team-x", "team-y"],
  "labelSelector": "app.kubernetes.io/part-of=checkout",
  "mode": "metadata" }            // "metadata" | "full"

// S→C: snapshot dump then sync marker
{ "type": "begin", "id": "s1" }
{ "type": "items", "id": "s1", "objs": "<msgpack batch>" }
{ "type": "sync",  "id": "s1", "rv": "128371" }

// S→C: live deltas (batched, coalesced per key under backpressure)
{ "type": "delta", "id": "s1", "rv": "128402",
  "ops": [ ["m","<key>","<msgpack obj>"], ["d","<key>"] ] }

// C→S: unsubscribe
{ "type": "unsub", "id": "s1" }
```

### 4.2 Rules
1. Keys are `ns/name`; ordering within a delta batch is authoritative (apply sequentially).
2. `rv` monotonic per topic; client may request `resync` after reconnect instead of replaying missed windows (simpler and always correct).
3. Exec/logs/port-forward use separate channel types on the same socket: `{type:"chan-open", kind:"exec", …}` → binary frames prefixed with channel id.
4. REST endpoints handle: CRUD mutations (SSA), kubeconfig management, Helm ops, settings, plugin registry. Anything request/response-shaped is REST; anything continuous is WS.

## 5. Frontend Architecture

```
React SPA (Vite, TS strict)
├── Transport layer     ws-client (auto-reconnect, resync), rest-client
├── State layer         topic stores (Map<key,obj>, immutable snapshots)
│                       + TanStack Query for REST resources
│                       + Zustand for UI-only state (layout, prefs)
├── Render layer        TanStack Virtual everywhere lists can be long
├── Feature modules     workloads/ network/ config/ rbac/ helm/ topology/
│                       timeline/ terminals/ settings/ ai/
└── Design system       tokens (CSS variables) → components (Radix + Tailwind)
                        themes: dusk (dark, default) · dawn (light) · high-contrast pair
```

Key decisions:
- **Topic stores, not global caches:** each subscription owns a plain ordered map keyed `ns/name`; components subscribe with selector functions. Immutable snapshot swap per frame batch keeps React reconciliation cheap.
- **Virtualization end-to-end:** tables render only visible rows; tested target 60fps @ 100k rows.
- **Detail views fetch full objects** via REST on selection (cheap, precise), while rows ride metadata streams.
- **Command palette (⌘K):** fuzzy index over navigation, resources-in-view, actions, and recent items; fully keyboard-navigable UI (Vim-ish bindings optional profile).
- **No MUI.** Custom design system on Radix primitives + Tailwind consuming theme tokens only — lint rule forbids raw color literals outside token definitions.

## 6. Deployment Surfaces (same engine)

| Surface | How | Auth |
|---|---|---|
| **Desktop** (macOS/Win/Linux) | Tauri 2 shell spawns engine binary as sidecar; shell ↔ engine over localhost WS | Ephemeral session token; OS keychain for credential helpers |
| **Personal web** | `kubebay serve --port 9898` serves SPA + API from the single binary (`embed.FS`) | Local token; optional basic/OIDC proxying left to user's reverse proxy |
| **In-cluster team** | Official Helm chart; engine runs inside cluster, impersonates OIDC-authenticated users | OIDC → impersonation headers → native RBAC decides (no shadow permissions) |

Mobile: **deferred by design** (see PRD §Platforms). Responsive web covers read-only triage; revisit native shells post-Phase 3 using Tauri 2 mobile targets against the same SPA.

## 7. Performance Engineering

This is a product feature, not an optimization afterthought.

**Techniques (and why they're enough):**
1. Shared informers + fan-out (A2) → constant upstream load regardless of tab count.
2. Metadata-only watches for lists (§3.2) → memory ∝ *viewed* objects, not cluster size.
3. resync=0, event-driven everything → idle CPU ≈ 0%.
4. Binary msgpack deltas + batched flush (16 ms tick) → no JSON.parse pressure, fewer syscalls.
5. Virtualized rendering → DOM size constant vs row count.
6. Lazy informer lifecycle (A4) → connecting to 10 clusters costs nothing until browsed.
7. Shell budget: Tauri (no bundled Chromium) → RAM floor ~40–80 MB instead of Electron's 200–400 MB.

**Budgets are enforced**, not aspirational — CI runs the perf harness (kind clusters seeded via fake workload generator) on every PR:

| Metric | Budget | Freelens/Lens reality (measured publicly) |
|---|---|---|
| Idle RSS, desktop, 1 cluster | ≤ 150 MB | ~300–500 MB common |
| Cold start → interactive | ≤ 1.5 s | ~3–4 s |
| Installer size | ≤ 40 MB | ~150–250 MB |
| Idle CPU | ≈ 0% | measurable background churn reported |
| Scroll, 100k-row table | 60 fps | jank reported on large lists |
| Watch-to-paint p95 (local) | ≤ 100 ms | n/a |

Regression rule: any PR that moves a red metric fails CI. Details & methodology live next to the harness in Phase 0 code.

## 8. Failure Modes & Handling

| Failure | Behavior |
|---|---|
| API server watch drops (network blip) | Reflector re-watches from last RV/bookmark; UI shows "reconnecting" banner only after 2 failed attempts |
| `410 Gone` (RV too old) | Automatic relist + fresh snapshot; clients receive new `sync` marker |
| OIDC token expiry | Proactive refresh; on failure, cluster marked `degraded` with re-auth prompt |
| Engine crash (desktop) | Tauri sidecar supervisor restarts w/ exponential backoff; UI shows crash report dialog |
| Slow/hung client | Coalescing + bounded queues (§3.3); disconnect after sustained stall |
| Malformed CRD / broken discovery | Isolate per-GVR failures; other resources keep working |

## 9. What We Explicitly Rejected (and why)

- **Electron-first** (Freelens path): repeats the bloat mistake; Tauri chosen with Electron documented as fallback shell if webview parity issues emerge.
- **Pure Node.js engine** (Lens path): JS K8s client lacks client-go-grade informer machinery; Helm requires CLI shelling.
- **Rust engine**: kube-rs is good but informer/cache maturity and the absence of a native Helm SDK make Go the pragmatic choice today.
- **SaaS control plane**: contradicts local-first trust principle; in-cluster self-hosted mode delivers the team-sharing value without holding anyone's credentials hostage. (Decision record: PRD §Platforms.)
