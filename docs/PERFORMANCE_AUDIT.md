# Performance audit (backlog 23), pass 1

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
- Open risk: `main.tsx` sets a global `refetchInterval: 30_000`, so every mounted query without its own interval polls every 30 s. Many of those are data the stream or an event already keeps fresh.

## Tests added
- `components/__tests__/resourceListScale.test.tsx`: window size, hover does not re-render cells, sort reads each row once.
- `lib/__tests__/useResourceStreamBurst.test.tsx`: burst coalescing.
- `lib/__tests__/useWsStatus.test.tsx`: unchanged status does not re-render.
All count work, not time, so they do not depend on CI load.

## Done
Hover re-render, sort decoration, `useWsStatus` bail-out, five regression tests.

## Not done
- Real profile in the Tauri app (React Profiler, Safari timeline) on a 5,000-pod cluster.
- Minified shell build and entry-chunk size/parse measurement.
- Bundle bytes: not rebuilt in this pass.

## Next
1. Drop the global 30 s `refetchInterval` default and give polling queries their own interval; check each page still refreshes.
2. `React.memo` the row (`TableRow` children) so a stream flush re-renders only changed rows: needs stable `onClick`/menu callbacks per row.
3. Profile Workloads and WorkloadsOverview, which join several streams per render.
4. Decide on minifying the shell while keeping source maps.
