# Many clusters: 50, 100, 1000 in one Kubebay

> Backlog item 37. Researched 2026-11-18 against `main` at v0.7.6. Read-only research: nothing here is built.
>
> Labels: **read** = taken from the code (file named); **estimated** = arithmetic from assumptions stated here; **not measured** = no benchmark was run for this note; **unverified** = a claim about the world outside this repo.

## 1. The question

Can Kubebay hold 50, 100 or 1000 clusters together without hanging the machine, and how should caching work: keep the last 4-5 opened clusters warm, or something else?

## 2. Short answer

**Listing 1000 clusters is fine. Being connected to 1000 at once is not, and should not be allowed.** Cost is per *connected* cluster, not per cluster in the kubeconfig, so the policy is: **lazy connect, a small LRU of warm clusters (default 5, setting 3-10), idle eviction of the rest, and a hard cap on background work.** "Last 4-5 opened" is the right core, with three additions: pinned clusters are exempt, a cluster you are looking at is never evicted, and a cheap *summary-only* tier covers the "fleet dashboard" case without full streams. Two things scale badly today independent of connections: the 30 s health probe of every kubeconfig entry (4.1) and the picker's un-virtualised list (4.6).

## 3. What happens per connected cluster today (read)

| Layer | Behaviour | Source |
|---|---|---|
| Kubeconfig load | Every context becomes an entry with an ID; `Connect(id)` only sets a `connected` flag. Nothing streams until a client subscribes. | `engine/internal/clusters/manager.go` (`Load`, `Connect`) |
| Health loop | Every 30 s, one goroutine **per entry** runs `probe` (5 s client timeout, 12 s hard cap), whether or not the cluster is connected. Exec credential plugins (aws, gke) run inside it. | `manager.go` `healthLoop`, `probe` |
| Informer pool | One `Pool` per cluster (and per impersonated identity). One shared informer per (GVR, namespace, selector, mode). `metadata` mode uses the metadata informer; `full` uses the dynamic one. Resync 0. A `managedFields` and last-applied trim is applied on entry. | `engine/internal/informers/pool.go`, `pool_registry.go` |
| Pool eviction | An entry with no subscribers is stopped after 2 min (`evictAfter`), swept each minute. **A pool whose subscribers never leave is never evicted.** There is no cap on pools or entries. | `pool.go` `sweeper` |
| Web background streams | `connectCluster(id)` opens 7 subscriptions per cluster: pods, deployments, statefulsets, daemonsets, jobs (all `full`), nodes, namespaces (`metadata`), and keeps them until `disconnectCluster`. Switching clusters deliberately does **not** disconnect the previous one ("multi-cluster streaming keeps all connected clusters' streams alive"). | `web/apps/shell/src/lib/clusterConnections.ts`, `App.tsx` `setActive` (~l.585) |
| Active-cluster prewarm | `usePrewarm` adds streams for the *active* cluster only: cronjobs, services, events, configmaps, ingresses, Helm Secrets, plus the 7 above (shared in the engine, a second hook-level copy in the browser). | `lib/usePrewarm.ts` |
| Stream cache | Module-level LRU by stream, capped at **50,000 rows total** (`MAX_CACHED_ROWS`). | `lib/streamCache.ts` |
| Live stores | `clusterConnections` keeps each stream's rows in `conn.stores`, **uncapped**, plus a copy in the stream cache every 2 s when dirty. Notify to React is 1 Hz and suspended while the window is hidden. | `clusterConnections.ts` |
| Picker | `clusterSummary(c.id)` walks every pod of a connected cluster and runs `derivePod` on each, per render of the picker. | `pages/ClusterPicker.tsx` ~l.365, `clusterConnections.ts` |
| Palette | Searches `getClusterRows` of connected clusters from memory (no new streams). | `lib/usePaletteObjects.ts` |
| Browser to engine | One WebSocket (`/ws`) carries all subscriptions; deltas are coalesced by the hub. | `lib/ws.ts`, `engine/internal/stream/hub.go` |

## 4. What scales badly

### 4.1 The health loop is O(kubeconfig), not O(connected)
1000 contexts means 1000 probes every 30 s, about 33 per second on average, plus an exec credential plugin per probe (a process spawn for aws/gke contexts). On a laptop this is a steady CPU and process-table cost and a stream of API-server hits against clusters you are not using; a stale SSO session could also be triggered. *Not measured.* **This is the first thing that would hang a 1000-context machine, and it does so with zero clusters connected.**

### 4.2 Per connected cluster cost (estimated)
Assumptions (typical, not measured here): a pod held as a full object with `managedFields` and last-applied trimmed is on the order of 3-6 KB in the engine's Go heap and a similar size as a parsed JS object in the browser; other kinds smaller; the Go informer and the JS store each hold one copy, and the stream cache a third (capped).

| Cluster size | Objects in the 7 streams | Engine heap | Browser (store + cache copy) | Watches | Initial LIST |
|---|---|---|---|---|---|
| Small (50 nodes, 1.5k pods) | ~2k | ~10 MB | ~15-20 MB | 7 | 7 LISTs |
| Medium (200 nodes, 8k pods) | ~10k | ~50 MB | ~70-100 MB | 7 | 7 LISTs, pods ~10 MB payload |
| Large (1000 nodes, 40k pods) | ~50k | ~250 MB | ~350+ MB | 7 | pods LIST tens of MB, seconds |

So 5 medium clusters is roughly 250 MB engine plus 400 MB browser: fine. 50 medium clusters is 2.5 GB plus 4 GB: not fine. 1000 small clusters is about 10 GB plus 15 GB: impossible. The uncapped `conn.stores` is the browser-side risk, since the 50k-row budget protects only the cache copy. *All figures estimated; a measurement harness is phase 0.*

Connection cost: each cluster is 7 long-lived HTTP watches from the engine (HTTP/2 may multiplex them onto one TCP connection per cluster, **unverified** for every client-go transport config, so assume 1 to 7 sockets). 100 clusters is 700 watches; OS limits are not the problem, API-server load and reconnect storms are.

### 4.3 Reconnect storm after wake or network change
All warm clusters re-LIST at once when the laptop wakes. With 5 clusters this is a blip; with 50 it is 350 LISTs concurrently, the likely source of "the machine hangs for a minute". No concurrency limit exists today (read: `entryFor` starts informers immediately). *Not measured.*

### 4.4 Never-evicted pools
`evictAfter` only fires for entries with zero subscribers. Background streams count as subscribers, so every connected cluster's entries live until the user disconnects. There is no notion of "not looked at for 30 min".

### 4.5 Fan-out in the browser
Every delta from every connected cluster crosses the single WebSocket and is applied on the main thread, even for clusters on no visible page. Hidden-window throttling exists for React notification (1 Hz, paused when hidden) but the apply cost remains. *CPU not measured.*

### 4.6 Picker and sidebar with many entries
`ClusterPicker.tsx` has no virtualisation (read: it does not use the virtualiser the tables use, `useTableVirtualizer`). 1000 cards with sparklines and a `clusterSummary` per connected one will cost layout time on every 1 Hz notify. Search and sort (`clusterSort.ts`) are O(n) and fine.

## 5. What others do (**unverified**, not re-checked for this note)

Lens and Freelens connect per cluster on demand and keep a cluster's view alive only while open; k9s works on one context at a time. None is known to hold hundreds of clusters live. The working assumption "no mainstream desktop tool streams hundreds of clusters" supports lazy connect.

## 6. Recommended policy

**Principle: the cost of a cluster is paid only while it is warm, and the number warm is bounded.**

1. **Lazy connect (already true), made explicit.** Opening the app connects at most the last active cluster. Listing clusters never opens a stream.
2. **Warm LRU, default N = 5 (setting, range 1-10).** "Warm" means the 7 background streams. Opening a 6th evicts the least recently *viewed* warm cluster: `disconnectCluster` on the web, and the engine pool closes through the existing disconnect hook. The active cluster and pinned clusters (favourites already exist) are never evicted. An evicted cluster shows a one-click "Reconnect" and is re-listed on next open; its stream cache is cleared (`clearStreamCacheForCluster`), so memory falls.
3. **Idle eviction.** A warm cluster not viewed for 30 min (setting) goes cold even if under N; a hidden window for 10 min cools everything except the active cluster. This is what the engine's 2-minute `evictAfter` cannot do, because background streams count as subscribers.
4. **Cap background work.** At most 3 concurrent initial LISTs across clusters (a semaphore around informer start in the engine), jittered reconnect after wake, and no background stream for clusters not viewed this session.
5. **Health probes only for what is shown.** Probe connected and pinned clusters every 30 s; probe the rest on picker open and then at most every 5 min, in batches of about 10, and never run exec plugins for a cluster that is not on screen. Show "last checked" for the long tail.
6. **Summary tier for the fleet view (optional).** For "is anything red across 100 clusters", use one cheap call per cluster (a `nodes` metadata LIST or a count), on demand and cached 60 s, not 7 watches. A separate, bounded feature and the honest answer to the 100-cluster dashboard wish.
7. **Browser memory guard.** Cap `conn.stores` by the same row budget as the cache (drop the least recently viewed cluster's stores first) so the guarantee is global, not just for the cache copy.
8. **Picker.** Virtualise the list above about 100 entries; compute `clusterSummary` only for visible cards and memoise it per sync version.
9. **1000-context kubeconfigs.** Group by kubeconfig file or cloud account, collapse by default, make search the primary control. Do not render 1000 sparklines.

Why not "cache the last 4-5 opened" alone: it bounds memory but not the health loop (4.1), the wake storm (4.3) or the picker (4.6), and it could evict a cluster you pinned for on-call.

## 7. Phased plan

| Phase | Ships | Size |
|---|---|---|
| 0. Measure | A throwaway harness (kind clusters seeded with N pods, or recorded fixtures) reporting engine RSS, browser heap, LIST time and watch count per connected cluster. Replaces every "estimated" above. | S |
| 1. Stop the free lunch | Health loop probes only connected, pinned and visible clusters, batched, with a long-tail interval (item 5). Picker virtualisation and memoised summary (item 8). | S-M |
| 2. Warm LRU | N-cluster LRU, pin exemption, setting, reconnect affordance (items 2, 7). | M |
| 3. Idle and storm control | Idle and hidden-window cooling, LIST semaphore, wake jitter (items 3, 4). | M |
| 4. Fleet summary | On-demand summary tier and grouping for huge kubeconfigs (items 6, 9). | M |

## 8. Acceptance checks (measurable)

Each uses kind clusters or recorded fixtures; thresholds are proposals to confirm in phase 0.

1. **Kubeconfig of 1000 contexts, none connected:** engine CPU averaged over 5 min under 5% of one core; zero exec plugin spawns for unshown clusters; picker first paint under 500 ms; scrolling holds 60 fps.
2. **Open 12 clusters in sequence:** warm count never exceeds N (a debug counter); engine RSS and browser heap plateau within 10% after the 6th open; re-opening an evicted cluster shows rows within the cold-start time from phase 0.
3. **Evicted cluster is gone:** no subscription ids for it remain in the hub, `streamCacheSize()` has no key with its prefix, and the API server shows no open watches from the engine for it.
4. **Wake storm:** simulating 5 warm clusters dropping and returning, concurrent LISTs never exceed the semaphore and the UI main thread has no long task over 200 ms.
5. **Idle cooling:** window hidden 10 min leaves only the active cluster warm; foregrounding restores it without a skeleton on the active cluster.
6. **Pinned and active are never evicted** (unit test on the LRU).
7. **Regression guards:** existing `clusterConnections`, `streamCache` and `usePrewarm` tests stay green; the new LRU and probe-batching logic is written test-first per CLAUDE.md.

## 9. Open questions

- Is the pod `full` stream needed in the background at all, or would `metadata` plus on-demand full on page open cut most of the memory? (The Overview's pod health needs status, which metadata does not carry.)
- Should N be a count or a row budget? A row budget is closer to the real cost; a hybrid (count cap plus global row budget) is likely best.
- Impersonated identities create a pool per identity (`registryKey`), which multiplies cost in shared-engine mode; the LRU must count pools, not cluster IDs.
