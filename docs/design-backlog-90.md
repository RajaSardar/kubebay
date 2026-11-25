# Backlog 90: sideways scrolling after a search, and scrolling in general

Diagnosis only. No fix is in this commit. Owner's words: "still the issue persists
after searching in pods, if I want to scroll side by side it is not working
properly ... re-check the entire scrolling mechanism and fix scrolling in general,
it is not smooth enough."

## Verdict

The sideways scroll is broken by one thing, and it is not the table, the
scrollbar from item 67, or the column widths: a **global, non-passive `wheel`
listener on `document`** (`web/apps/shell/src/main.tsx:36-57`) that calls
`preventDefault()` on every wheel gesture that cannot scroll *vertically*. It
looks only at `deltaY` and only at `overflow-y`. A horizontal gesture
(`deltaX`, `deltaY` = 0) is never "consumed", so it is cancelled. After a search
the list is short, nothing can scroll vertically any more, and every gesture,
sideways ones included, is cancelled. That is why it shows after searching, and
why item 67's bottom scrollbar (which only handles drag, click and keys) did not
fix the trackpad. The same listener is also why scrolling is not smooth: it makes
every wheel event wait for the main thread.

## How it was measured

No desktop app, cluster or real kubeconfig was touched. A mock engine
(`/tmp/kubebay-work/h/mock.mjs`, Node `http` + `ws`, msgpack frames as in
`engine/internal/stream/protocol.go`) serves the production build of the shell
(`vite build`, unminified as the repo ships it) and streams 2,000 pods, with an
optional churn of modified pods and a fake log channel. Headless Chromium 141 via
Playwright 1.56 on the dev laptop, viewport 1440x900, `/workloads` (the Pods
table; 14 columns, table 1476 px wide in a 1174 px viewport). Scripts
(`repro.mjs`, `perf.mjs`, `prof.mjs`, `trace.mjs`, `ack.mjs`, `logs.mjs`,
`zero.mjs`) and traces stay under `/tmp/kubebay-work/`. Playwright's
`mouse.wheel` sends real input events through the browser input pipeline, so the
document listener sees them. Limits: headless Chromium is not WKWebView, there
is no GPU raster, and numbers are relative (handler present vs removed), not
absolute app numbers. The WKWebView rubber-band behaviour the handler was written
for could not be checked and must be checked by the owner on the desktop build.

## Reproduction of the owner's case

`scrollLeft` after one gesture over the table (reset to 0 before each row):

| Gesture | 2,000 pods | Filtered to 2 rows (no vertical room) |
|---|---|---|
| wheel dx=300, dy=0 (pure sideways) | 0, `preventDefault`ed | 0, `preventDefault`ed |
| wheel dx=300, dy=3 | 300 | **0**, prevented |
| wheel dx=300, dy=-3 (at top) | **0**, prevented | 0, prevented |
| 5 x wheel dx=60 (a trackpad stream) | **0**, all five prevented | 0, all prevented |
| wheel dy=300 (vertical) | scrollTop 300 | **0**, prevented |
| drag the item-67 scrollbar thumb 100 px | 126 | 126 |
| End key on the scrollbar | 302 (max) | 302 |

- The scroll container is the right element: `.table-wrap` has
  `scrollWidth` 1476 and `clientWidth` 1174, and the table keeps its 1476 px width
  after filtering (no collapse). Header and body cells stay aligned
  (`th` and `td` left edges identical at every offset).
- Drag, click and keyboard on the item-67 bar all work. Only the wheel does not.
  On macOS a trackpad swipe or shift+scroll arrives as `deltaX` with `deltaY`
  near 0, which is the "pure sideways" row.
- With the document listener neutralised (A/B), the same filtered case gives
  scrollLeft 300 for pure sideways, jitter, upward jitter and the 5-event stream.
- Secondary: a search that matches nothing swaps the table for the empty state
  (`ResourceListView.tsx` `rows.length === 0` branch), which unmounts
  `TableWrap`; the sideways position is lost (250 before, 0 after clearing to
  "web").

## Smoothness measurements

Wheel round trip, 80 vertical wheel events, main thread otherwise idle or busy
for N ms of every 100 ms (what a stream-driven React commit looks like):

| Main thread busy | handler present p50 / p90 / max | handler removed p50 / p90 / max |
|---|---|---|
| 0 ms | 36.9 / 41.9 / 69.4 ms | 20.2 / 21.3 / 66.9 ms |
| 40 ms | 54.2 / 78.8 / 107.8 ms | 37.5 / 54.5 / 159.1 ms |
| 80 ms | 90.9 / 185.5 / 267.1 ms | 86.8 / 87.8 / 187.1 ms |

Roughly one extra frame (about 17 ms) of input latency, and a fatter tail when
the main thread is busy: the listener is `{ passive: false }`, so the compositor
cannot scroll until the page's JS has run. Per-event listener cost is small
(0.1 ms, 81 wheel dispatches = 8.4 ms in the trace), it is the main-thread gate
that costs.

Frame pacing, 3 s of wheel input (dy=40 every 16 ms), 2,000 pods:

| Config | Vertical fps / frames over 25 ms | Sideways fps / frames over 25 ms |
|---|---|---|
| 1x CPU, no churn | 59.4 / 1 | 60.0 / 0 |
| 6x CPU throttle, no churn | 33.4 / 51 (10 over 50 ms, max 100 ms) | 59.4 / 3 |
| 6x CPU, 40 pod updates/s | 21.9 / 56 (20 over 50 ms, p50 49.9 ms) | 47.2 / 33 |
| 6x CPU, 40 updates/s, handler removed | 22.2 / 55 | 41.6 / 43 |

So on this machine the table itself holds 60 fps at 1x; it falls apart under CPU
pressure (a slower laptop, a busy machine) and under live stream updates, which
is a real cluster's normal state. Removing the listener alone does not fix the
jank under load (last row): the render cost below does.

React commits per wheel event (`__REACT_DEVTOOLS_GLOBAL_HOOK__` commit counter):
vertical 5.1, sideways 0.77, **sideways with 40 updates/s 5.4** (the commits are
stream flushes, not the scroll). CPU profile and trace over 4 s of vertical
scroll at 1x: main thread busy 1.48 s of 4 s. Native work (style, layout, paint,
layerize: UpdateLayoutTree 152 ms x413, Layout 59 ms x84, PrePaint 97 ms,
Paint 383 ms, Layerize 133 ms) is the bulk; JS (FunctionCall) 253 ms. The one
named JS hot spot is the forced layout `get scrollWidth` at 89 ms (7% of busy
time), then with churn the default sort callback `byNsThenName` at 98 ms.

Log view (`PodPanel` Logs tab, 5,000 lines, 20 to 200 lines/s, 1x CPU):
156 frames in 4 s, 63 over 25 ms, max 83 ms, 6 long tasks (max 55 ms); at only
20 lines/s, 35 long tasks (max 84 ms), 69 of 122 frames over 25 ms, p50 33 ms.

## Causes, ranked

1. **Global non-passive wheel listener cancels sideways scrolling** (the owner's
   bug). `web/apps/shell/src/main.tsx:33-57`. Checks `overflowY` and `deltaY`
   only (`:44-48`), then `e.preventDefault()` (`:55`). Evidence: the table above.
   Introduced in the initial commit as "belt-and-suspenders" for WKWebView
   bounce; `app.css:13-16` already sets `overflow: hidden` and
   `overscroll-behavior: none` on `html, body, #root`, and `.sidebar` and
   `.drawer`/`.table-wrap` chains set `overscroll-behavior-y: contain`
   (`app.css:197`, `styles.css:324`).
2. **Same listener makes all scrolling main-thread-gated** (smoothness). Every
   wheel event runs `getComputedStyle` up the whole ancestor chain (a forced
   style read per event, `main.tsx:41-42`) and blocks compositor scrolling until
   it returns. Measured +17 ms p50 latency, worse when React is committing.
3. **Whole-list work on every stream flush while scrolling.** Each 16 ms flush
   (`useResourceStream.ts` `scheduleFlushRef`) re-renders `Workloads`, re-derives
   rows, and `useResourceList.ts:56-75` re-filters and re-sorts all 2,000 rows
   (`shown` memo depends on `rows`), then `ResourceListView` re-renders. 5.4
   commits per wheel with churn vs 0.77 without; 6x CPU drops sideways from 59 to
   47 fps. Scrolling itself does not need any of this.
4. **Forced synchronous layout after every commit.** `HScrollBar`
   (`web/packages/ui/src/hscrollbar.tsx:34-38`) reads `scrollWidth`/`clientWidth`
   in a `useLayoutEffect` with no deps and in a scroll listener (`:52`), and
   `useTableVirtualizer.ts:27-29` reads `getBoundingClientRect` in a deps-less
   `useLayoutEffect`. Both run after React mutated rows, so layout runs inside
   the commit instead of once per frame (`get scrollWidth` 89 ms per 4 s of
   vertical scroll). `TableWrap` (`table.tsx:92-115`) re-renders `HScrollBar` on
   every virtualizer tick because it is not memoised.
5. **Virtualizer re-renders the whole list component on every scroll offset.**
   `useTableVirtualizer.ts:31-38` (`useVirtualizer`, overscan 8) rerenders
   `ResourceListView` (653 lines, many hooks and memos) once per scroll frame
   (5 commits per wheel gesture, because Chromium smooth-scroll animates one
   wheel over ~5+ frames). Rows are memoised (`ListRow`, `sameRow`) so JS is
   cheap, but the row mount/unmount is native layout and paint (above). Each
   row is also measured (`measureRef` = `virtualizer.measureElement`, a
   ResizeObserver per row) although `ROW_HEIGHT[density]` is fixed and the cells
   are `white-space: nowrap`.
6. **Log views render every line and re-render all of them on each batch.**
   `PodPanel.tsx:321-323`, `WorkloadLogs.tsx:132`: 5,000 `LogLine`s
   (`usePodLogs.ts:6` `MAX_LINES`), `key={i}`, no memo or windowing, plus
   `scrollTop = scrollHeight` (`PodPanel.tsx:99`, forced layout) on every batch.
   Measured above.
7. **Smaller items.** The empty-state swap drops the sideways position (see
   above). `.np-corner`, `.np-col-header`, `.np-row-header` (`app.css:1805-1850`)
   are sticky cells with `backdrop-filter: blur(8px)` inside a scroller, which
   repaints the blur on every scroll tick on the Network Policy matrix. `tr:hover`
   plus `transition: background` (`styles.css:648`) restyles rows moving under a
   resting pointer while scrolling. The global 4 px `::-webkit-scrollbar`
   (`app.css:47-63`) is why native bars are hard to see and item 67 drew its own.
   No `content-visibility`, `will-change`, or scroll-linked rAF loops exist in the
   shell (checked), and the sidebar and dock have no scroll handlers.

Not causes, checked and ruled out: column widths or `table-layout: fixed`
collapsing after a filter; header/body misalignment; the wrong element being the
scroll container; the item-67 scrollbar itself; `useColumnWidths`; sticky pinned
columns (aligned, no flicker in screenshots); page-level `min-width: 0` chains
(`.content` and `.page` clip, `.table-frame` has `min-width: 0`).

## Fix plan (each step TDD, a failing test first)

1. **Remove the wheel listener** (or, if the desktop check shows WKWebView
   bounces without it, replace it with CSS: `overscroll-behavior: none` on
   `html, body, #root, .content, .page`). Never ship a replacement that is
   non-passive. Tests: extract nothing; a Vitest test that `main.tsx` registers no
   non-passive `wheel` listener on `document`, plus a Playwright check against the
   mock harness (script kept in `e2e/`-style, saved output under `/tmp/kubebay-work/`)
   that a pure `deltaX` wheel moves `.table-wrap.scrollLeft` with 2,000 rows and
   with a 2-row filter. Owner confirms on the desktop build that there is still no
   window bounce.
2. **Preserve sideways position across the empty state**: keep `TableWrap`
   mounted for the zero-row case (render the empty state inside it or lift the
   scroll position). Test: scrollLeft survives a no-match filter and back.
3. **Stop forcing layout**: `HScrollBar` measures in a `ResizeObserver` and a
   rAF-throttled scroll handler, not in a deps-less layout effect, and is
   `memo`'d; `useTableVirtualizer` measures the header once with a
   `ResizeObserver`. Test: render counts and that `scrollWidth` is not read
   during a vertical scroll tick.
4. **Cut per-flush and per-scroll work**: cache the sorted/filtered order so a
   stream flush with unchanged sort keys re-sorts only changed rows (or at
   least skip the sort when `rv`s are unchanged); give the virtualizer
   `useFlushSync: false`, fixed row size (no per-row `measureElement`) for the
   fixed-height tables, and keep the list header and toolbar out of the
   per-scroll render. Budget to assert in `perf/`: vertical scroll, 2,000 pods,
   6x CPU, 40 updates/s: p95 frame under 34 ms, no frame over 100 ms, commits
   per wheel event under 2.
5. **Windowed log view**: virtualise `.log-view` (same `@tanstack/react-virtual`),
   `React.memo` `LogLine`, stable keys, and pin to bottom with a single
   scroll-to-end per frame. Budget: 5,000 lines at 200 lines/s, zero long tasks
   over 50 ms.
6. **Network Policy matrix**: drop `backdrop-filter` from the sticky headers
   (opaque `--kb-*` surface instead; contrast test already covers it).
7. Docs: manual page for the Pods table (sideways scrolling by trackpad,
   shift+wheel, scrollbar), `CHANGELOG.md` [Unreleased], `whatsnew-gen`.

Items 1 and 2 close the owner's report. Items 3 to 6 are the "not smooth enough"
work and should each land with the before/after number from the same harness.
