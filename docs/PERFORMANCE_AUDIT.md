# Performance audit (backlog 23), passes 1 to 3

Method: source reading plus counting tests. No builds, no device profile, so
nothing here is a wall-clock number. Counts below were measured by the new
tests, before and after each fix.

## Findings

### Bundle
- Every route except `ClusterPicker` is `React.lazy` in `App.tsx` (Settings, Workloads, ResourceTable, Topology, Helm, Rbac, and the rest). Nothing to split.
- Monaco is behind a dynamic import and `build/staysLazy.ts` fails the build if it becomes reachable from an entry chunk. xterm is only reached through `DockShell` (lazy) and `ExecTerm`; `@xyflow` only through the lazy Topology page.
- The shell is deliberately shipped unminified with source maps (`build.minify: false`; only Monaco is minified by `shipMinified`). Measured and kept in pass 3; see "Pass 3: the minify decision" below.

### Render cost
- Streams (`useResourceStream`): already coalesced (16 ms flush, paused while the window is hidden, rows rebuilt once per flush). New test pins it: 300 delta frames cause at most 3 renders.
- `ResourceListView`: rows are virtualised (test: 3,000 rows mount fewer than 150 DOM rows).
- Fixed: a `hoveredKey` state re-rendered the whole list, every cell included, on each row mouse-enter and mouse-leave. CSS `:hover` already shows the kebab, so the state was redundant. Measured: 8 hovers re-ran 288 cell renders before, 0 after.
- Fixed: `useResourceList` sorted with `sortValue` called twice per comparison. Measured on 2,000 rows: 38,108 calls before, 2,000 after.
- Fixed: `useWsStatus` set a new object on every socket status event, so `AppInner` (the whole shell) re-rendered on events that changed nothing (the 5 s stable timer re-announce). Measured: 2 extra renders per pair of repeated events before, 0 after.

### Polling
- `["clusters"]` refetches every 4 s from `AppInner`, `ClusterStrip` and `ClusterPicker`; one request (same key), and react-query structural sharing keeps the data identity when nothing changed.
- React Query's default `refetchIntervalInBackground: false` pauses every interval while the page is hidden, so no per-query change was needed.
- Fixed in pass 2: the global `refetchInterval: 30_000` is gone (the client now lives in `lib/queryClient.ts`; `queryClient.test.ts` fails if a global interval returns). Queries that polled only through the default and still need it got an explicit interval: `history-status` in `UsageHistoryCard` (30 s) and `mcp` in `McpSettingsCard` (15 s, as `McpChip`). Every other query already had its own interval or, being the same key as a polled one (`clusters`, 4 s), is covered by it. Queries that no longer poll, on purpose: `crds`, `apis`, `apiversions`, `rbac`, `settings`, `triage`, `prom-status`, `helm-release/history/values/manifest`, `chart-*`, `resize-current`, `gpu-utilisation` (its own `staleTime` is 5 min), `configmap-env`, `fav-exists`. They refetch on mount once stale (30 s), on invalidation, and on cluster switch. Behaviour change to check in the app: a page left open no longer refreshes those every 30 s.

### Pass 2: row memoisation
- `ResourceListView` rows are now a memoised `ListRow`. A stream flush rebuilds the rows array, but a row re-renders only if its object changed (same reference, or the same non-empty `versionOf`, which is how Workloads' freshly derived `PodRow`s compare) or its own selection, active, dimmed, tint, visible columns, column definitions or cluster changed. Callbacks given to rows (`onOpen`, menu, namespace pick) are stable and read the latest props through refs, so Workloads' `onOpen` (which depends on `rows`) no longer defeats the memo. Measured with a cell render counter on 40 rows: rebuilt array with the same versions, 9 cell renders before and 0 after; one row changed, 27 before and 2 after (new values, then the tint), all for that row; selecting one row, 18 before and 1 after.
- Not done in pass 2: caching `derivePod` per raw object, and profiling the joins in Workloads and WorkloadsOverview. Both done in pass 3.

### Pass 3: `derivePod` cache
- `derivePod` (the Pods table's row, also used by Overview's pod status bar and the cluster strip's summary) ran for every pod on every flush. The stream keeps a pod's object while it is unchanged and stores a freshly decoded one when it changes (`useResourceStream`'s `applyOps`, and the module stream cache copies the same object references), so the object is a sound cache key. Rows are now cached in a `WeakMap` keyed on the object, so a removed pod's entry is collected with it; the entry also records `resourceVersion` and is recomputed if it differs, in case an object is ever edited in place.
- The unused `ageMs` field (from `Date.now()`) was dropped from `PodRow`, so a row depends only on its object; the Age column reads `created`.
- Measured at 2,000 pods (counting `status` reads, one per derivation): a flush with no changes, 2,000 derivations before and 0 after; one pod changed, 2,000 before and 1 after. The same holds in the rendered Workloads page with 500 ReplicaSets. Cached rows keep their identity, so `ListRow`'s memo now also hits by reference.
- `Workloads`' `openPod` found the raw pod with `rows.find` on every open; it now reads the `podObjects` map it already builds, and no longer changes identity on each flush.

### Pass 3: stream joins in Workloads and WorkloadsOverview
Profiled with a deterministic fixture (2,000 pods, 500 ReplicaSets, 500 Deployments, 500 Services, 500 EndpointSlices, 125 PDBs, 50 namespaces), counting property reads on the input objects through a Proxy.

| Join | Reads before | Reads after |
| --- | --- | --- |
| SPOF Radar, pods (`findClusteredReplicas`: `pods.filter` per workload) | 501,750 | 3,750 |
| SPOF Radar, PDBs (`pdbs.some` per single-replica workload) | 24,500 | 1,125 |
| SPOF Radar, EndpointSlices (`filter` per Service) | 250,500 | 1,000 |
| Service Health, pods (`pods.filter` per Service) | 1,000,000 | 2,000 |
| Service Health, EndpointSlices (`filter` per Service) | 250,500 | 1,000 |
| Overview tab: attention, status bar, pressure, capacity, namespaces, kind counts, CoreDNS (7 joins over pods) | 50,000 | 52,000 |
| Workloads Owner column, ReplicaSets read while resolving 2,000 pods | 0 (map built once) | 0 |

- Fixed with indexes built once per call: `lib/labelIndex.ts` (`LabelIndex`: pods by namespace and by each label pair, a selector starts from its smallest candidate list; `groupByLabel` for EndpointSlices by Service; `groupByNamespace` for PDBs). Behaviour is unchanged; the existing `spof` and `serviceSelectorMismatch` tests pass as they were.
- `findAttention` checked `rows.some` per Deployment; it now uses a Set of row keys (not counted by the Proxy, since `rows` is internal; linear by construction).
- The Overview tab's own joins were already linear (each pod read about 25 times across seven functions). The extra 2,000 reads after are `derivePod`'s cache checking `resourceVersion`. Workloads was already linear (`replicaSetOwners` builds a Map once per ReplicaSet stream change).

### Pass 3: the minify decision
- Where it is set: `web/apps/shell/vite.config.ts`, `build: { sourcemap: true, minify: false }`, since the initial commit. `build/shipMinified.ts` states the reason: "The shell ships unminified, with source maps, so its own code is debuggable in the field". Only chunks made entirely of `monaco-editor` code are minified and lose their maps. No doc or commit calls it temporary, so the setting is not changed.
- Measured from the existing `web/apps/shell/dist` (built 2026-11-18, possibly behind this commit; no build was run). Minified sizes are each chunk run through esbuild's minifier on its own, which is close to, not the same as, what `minify: "esbuild"` would emit.

| | Unminified (shipped) | Minified (esbuild) | Saving |
| --- | --- | --- | --- |
| Entry chunk `index-*.js` | 949 kB | 538 kB | 43% |
| Entry chunk, gzip | 228 kB | 176 kB | 23% |
| All 64 shell chunks (excluding Monaco and its worker) | 2.83 MB | 1.66 MB | 41% |
| All 64 shell chunks, gzip | 682 kB | 534 kB | 22% |
| Entry chunk compile, V8 `SourceTextModule`, best of 7 | 10.9 ms | 8.2 ms | 2.7 ms |

  Source maps add 5.4 MB on disk next to 7.0 MB of JS (Monaco included).
- Trade-off. For: about 1.2 MB less in the engine binary, which embeds `dist`, and roughly 3 ms less parse of the entry chunk on an M-class Mac (V8; Tauri's WebKit was not measured). The engine serves assets uncompressed over loopback, so transfer size barely matters. Against: stack traces and the Web Inspector in the field read as the source, with names intact, without needing the map to load; error reports pasted by users are readable as they are. With maps kept, minified code is still debuggable in a devtools session, but not in a copied stack trace.
- Verdict: keep `minify: false`. At 3 ms of parse and 1.2 MB of binary, the saving does not outweigh readable field stack traces. Reopen if the entry chunk grows past about 2 MB, if a Tauri/WebKit profile shows parse above 50 ms at startup, or if binary size becomes a distribution constraint; the cheapest middle ground then is `esbuild: { minifyWhitespace: true }` with identifiers kept, or minifying only `node_modules` chunks the way `shipMinified` does for Monaco.

## Tests added
- `components/__tests__/resourceListScale.test.tsx`: window size, hover does not re-render cells, sort reads each row once.
- `lib/__tests__/useResourceStreamBurst.test.tsx`: burst coalescing.
- `lib/__tests__/useWsStatus.test.tsx`: unchanged status does not re-render.
- `components/__tests__/resourceListMemo.test.tsx`: row re-render counts (pass 2).
- `lib/__tests__/queryClient.test.ts`: no global refetch interval; `UsageHistoryCard.test.tsx`: its own interval.
- `lib/__tests__/podsCache.test.ts`: derivations per flush, fresh data for a changed pod, no clock dependence (pass 3).
- `pages/__tests__/Workloads.derive.test.tsx`: derivations per flush in the rendered page at 2,000 pods and 500 ReplicaSets (pass 3).
- `lib/__tests__/overviewJoins.test.ts`: reads per object for every Overview and Workloads join at 2,000 pods (pass 3).
All count work, not time, so they do not depend on CI load.

## Done
Hover re-render, sort decoration, `useWsStatus` bail-out, five regression tests. Pass 2: row memoisation, polling. Pass 3: `derivePod` cache, indexed SPOF and Service Health joins, minify decision written up.

## Not done
- Real profile in the Tauri app (React Profiler, Safari timeline) on a 5,000-pod cluster.
- A real minified build: pass 3's sizes are per-chunk esbuild estimates from an existing `dist`, and parse time was measured in V8, not WebKit.
- Bundle bytes: not rebuilt in any pass.

## Next
1. Profile in the Tauri app on a 5,000-pod cluster, now that the counted costs are linear.
2. Other per-Service or per-workload scans outside the Overview (`attackPaths`, `blastRadius`, `routeResolution`'s port checks) may have the same per-object scans and could use `LabelIndex`; not checked or measured here.
