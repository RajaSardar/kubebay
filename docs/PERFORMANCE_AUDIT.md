# Performance audit (backlog 23), passes 1 and 2

Method: source reading plus counting tests. No builds, no device profile, so
nothing here is a wall-clock number. Counts below were measured by the new
tests, before and after each fix.

## Findings

### Bundle
- Every route except `ClusterPicker` is `React.lazy` in `App.tsx` (Settings, Workloads, ResourceTable, Topology, Helm, Rbac, and the rest). Nothing to split.
- Monaco is behind a dynamic import and `build/staysLazy.ts` fails the build if it becomes reachable from an entry chunk. xterm is only reached through `DockShell` (lazy) and `ExecTerm`; `@xyflow` only through the lazy Topology page.
- The shell is deliberately shipped unminified with source maps (`build.minify: false`; only Monaco is minified by `shipMinified`). That is the main reason the entry chunk is 845 kB. Not changed: it is a debuggability decision. Needs a measurement (parse time of entry chunk, minified vs not) before it is worth reopening.

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
- Not done: caching `derivePod` per raw object (it embeds `ageMs` from `Date.now()`, so a cache would need that field dropped first). Profile the join cost in Workloads and WorkloadsOverview.

## Tests added
- `components/__tests__/resourceListScale.test.tsx`: window size, hover does not re-render cells, sort reads each row once.
- `lib/__tests__/useResourceStreamBurst.test.tsx`: burst coalescing.
- `lib/__tests__/useWsStatus.test.tsx`: unchanged status does not re-render.
- `components/__tests__/resourceListMemo.test.tsx`: row re-render counts (pass 2).
- `lib/__tests__/queryClient.test.ts`: no global refetch interval; `UsageHistoryCard.test.tsx`: its own interval.
All count work, not time, so they do not depend on CI load.

## Done
Hover re-render, sort decoration, `useWsStatus` bail-out, five regression tests.

## Not done
- Real profile in the Tauri app (React Profiler, Safari timeline) on a 5,000-pod cluster.
- Minified shell build and entry-chunk size/parse measurement.
- Bundle bytes: not rebuilt in this pass.

## Next
1. Profile Workloads and WorkloadsOverview, which join several streams per render.
2. Decide on minifying the shell while keeping source maps.
