# Performance: what's measured, and how

KB-02. The budgets are in [PRODUCT_REQUIREMENTS.md §6](PRODUCT_REQUIREMENTS.md#6-performance-budgets).
This page says which of them CI measures, exactly how, and what each number
leaves out. Quote a number with its date, commit and this page, or don't quote it.

## In CI: `perf (kind)`

The job runs on every pull request and on main. It works in four steps:

1. Builds the engine with the web app embedded, the way releases build the standalone engine: no cgo, no `localshell` tag, and the compiler that go.mod's `toolchain` line names. So CI measures the binary releases ship. (The desktop app's engine also has the `localshell` tag, which adds the local terminal and nothing that runs until you open it.) `make build` adds the tag, leaves cgo on and uses the Go that setup-go installs (`GOTOOLCHAIN=local`), which is why the job doesn't use it.
2. Creates a kind cluster (Kubernetes 1.34, the integration suite's pinned node image).
3. Runs `perf/harness.mjs` against it.
4. Checks the result against `perf/budgets.json` with `scripts/perf-budgets.mjs`.

The table lands in the job summary, and `perf.json` is attached to the run as
the `perf` artifact for 90 days. Memory and CPU come from `/proc/<pid>/status`
(`VmRSS`) and `/proc/<pid>/stat` (user plus system time) of the engine process.
The runner is a GitHub-hosted `ubuntu-latest`, and `perf.json` records its CPU
count and memory.

| Number | How it's taken |
|---|---|
| **Cold start** (`coldStart.totalMs`) | Start the engine binary and time it until `/api/healthz` answers (`engineReadyMs`). Then open `/clusters` in a new Chromium context with an empty cache, the token handed over as the desktop app does. Time from navigation start to the frame after the cluster appears in the list (`firstFrameMs`). The total is the sum. Median of 5 runs, a fresh engine each time. |
| **Idle** (`idle.rssMB`, `idle.cpuPercent`) | One engine, connected to the cluster while it holds only kind's own system pods, with the app open on that cluster's Overview. After 20 s: the median RSS of 5 samples a second apart, then CPU over 10 s, as a percentage of one core. |
| **Idle, three clusters** (`idle3.rssMB`, `idle3.cpuPercent`) | The same, with three clusters connected and the app open on the first one's Overview. The three are the kind cluster under three context names (`kind-kubebay-perf`, `-2`, `-3`), which the engine connects to and health-checks as three clusters. |
| **Watch event to painted row** (`paint.p95Ms`) | The Pods page open, filtered to `perf-paint-`. The harness creates 30 pods one at a time, 250 ms apart, each with a single request to the API server (through `kubectl proxy`). Each sample runs from just before that request to the animation frame after the pod's row enters the page, on the wall clock the harness and the browser share. Each pod's name sorts before the last one's, so its row lands at the top of the table. The p95 is the nearest-rank 29th of 30; `runsMs` holds every sample, and `writeMs` the API server's median time to answer the create. |
| **Scrolling 100k rows** (`scroll.fps`) | The Pods page with 100,000 pods. The harness answers the page's pods subscription itself, frame for frame as the engine does (a begin frame, then 200 pods to a frame, then sync), with pods shaped like the generated ones; the engine serves everything else. One second after the first row appears, the table scrolls 100 px every animation frame for 5 s, about 6,000 px a second, and `fps` is the frames that ran in that time. `p95FrameMs` is the 95th-percentile frame time, and `lastRow` the bottom row when it stopped, which shows the table really moved. |
| **Watch load** (`watch[]`) | Generate N pods (1,000, then 10,000) in `kubebay-perf`. For each N and each mode (`metadata`, `full`), start a fresh engine and connect it. Subscribe to every pod in the cluster over the WebSocket, as the Pods page does, and time from subscribing to the engine's `sync` (`syncMs`). After 10 s, take the median RSS of 5 samples. `count` is how many of the generated pods the snapshot held; a run that saw fewer doesn't count. |

What these leave out:

- **Cold start is the web shell, not the desktop app.** The browser is already
  running, so the webview's own start-up isn't in it. For the desktop app, see
  below.
- **Idle RSS is the engine alone.** The PRD's 150 MB (one cluster) and 250 MB
  (three) cover the desktop shell and the engine together. The shell's webview
  isn't measured in CI.
- **Connected clusters cost little until a page watches them.** Connecting a
  cluster adds it to the engine's health check, every 30 s; its informers start
  when a page subscribes. With one of three viewed, the other two add almost
  nothing, and the three-cluster number shows that. Opening a page on each would
  cost what the watch-load rows do.
- **Idle CPU is the engine while the app is open.** With nothing attached, a
  connected engine uses no measurable CPU; what the budget sees is the engine
  serving the open page.
- **The generated pods are lighter than real ones.** They name a scheduler that
  doesn't exist, so they stay Pending: no node, no container statuses, small
  `managedFields`. Real pods cost the engine more memory each.
- **Watch to paint starts at the create request.** So it includes the API
  server's write (`writeMs`, under 10 ms on kind), and the API server's own
  delivery of the watch event, which nothing outside it can timestamp.
- **Scrolling measures the web shell, not the engine.** Its rows don't come
  from a cluster: 100k real pods would take kind longer than the job has. It
  runs in headless Chromium with no GPU, where 60 fps is the ceiling (a plain
  scrolling page runs at 60 there), on a 4-vCPU runner, slower than most
  laptops.
- **The PRD's 100k-pod budget isn't run in CI.** CI measures 10k. The budget
  file checks 10k against the 100k limit, which only catches gross regressions.
  It has been measured by hand; see below.
- **Not measured yet:** the desktop shell's own memory.

## Budgets fail the build

`perf/budgets.json` maps a metric to its limit and source: a `max`, or for
frame rate a `min`. A metric past its limit **fails the `perf (kind)` job**: an
error annotation on the run, "over" in the summary, and a non-zero exit from
the Budgets step (`--fail`). A budget that isn't measured is listed as "not
measured" and doesn't fail.

A budget marked `warnOnly` is a warning instead, "over (warning only)" in the
summary, until it has three stable runs on main; then the flag comes out. The
four added on 2026-10-22 (three clusters idle, watch to paint, scrolling) are
warn-only.

The budgets began as warnings (KB-02 step 4) and became failures on 2026-10-17,
after three stable runs on main:

| Run (commit) | Cold start | Idle RSS | Idle CPU | 10k pods, metadata |
|---|---|---|---|---|
| 6f06324 | 207 ms | 98.2 MB | 0.1% | 275.7 MB |
| e0c1d1f | 160 ms | 98.5 MB | 0% | 277.7 MB |
| 61f9c3d | 250 ms | 96.1 MB | 0.1% | 281.8 MB |
| **Limit** | 1500 ms | 150 MB | 1% | 400 MB |

A budget changes only through an ADR with evidence, as the PRD says.

## 100k pods, by hand

CI doesn't run the PRD's 100k-pod budget (Engine RSS ≤ 400 MB, metadata). It
was measured once with this harness (`--pods 10000,100000`) against a local
envtest API server (Kubernetes 1.34, etcd, no nodes) on a 4-CPU, 15 GB Linux
machine, with the generated pods described above, on 2026-10-22. The whole run
is `perf/results/2026-10-22-100k-envtest.json` (its `commit` is the branch's
base; the harness and engine were that branch's).

| Pods watched | Mode | Time to sync | Engine RSS |
|---|---|---|---|
| 10,000 | metadata | 1.1 s | 259.3 MB |
| 10,000 | full | 4.0 s | 339.8 MB |
| 100,000 | metadata | 11.5 s | **2,059.4 MB** |
| 100,000 | full | 33.8 s | 2,716.3 MB |

**At 100k pods the engine is about five times over the 400 MB budget.** Each
pod watched in metadata mode adds about 20 KB: (259.3 − 63.3) MB over 10k
pods, and the 100k run agrees. That is many times a generated pod's own size,
so the budget is unmet until the engine's per-pod memory comes down, or an ADR
changes the budget with this evidence. No README or website copy may claim it
meanwhile. CI's
10k row can't catch it: 10k pods sit well inside 400 MB.

### Where the memory goes (heap profile, 2026-10-27)

Same machine shape, envtest API server (Kubernetes 1.31), the same generated
pods, one Pods-page subscription in metadata mode, engine at 7f69174. The engine
was built with `net/http/pprof` added through `go build -overlay` (nothing in
the repo serves it). RSS was sampled from 10 s to 3 minutes after sync, and the
heap profile taken after a forced GC.

| Pods | Engine | Live heap | RSS 10 s | RSS 60 s | RSS 3 min |
|---|---|---|---|---|---|
| 20,000 | 7f69174 | 242.7 MB | 421 MB | 621 MB | 717 MB at 2 min |
| 20,000 | fixed | 50.7 MB | 438 MB | 553 MB | 375 MB at 2 min |
| 100,000 | 7f69174 | 1,187 MB | 1,923 MB | 2,883 MB | 3,498 MB |
| 100,000 | fixed | 226 MB | 2,040 MB | 2,363 MB | 1,853 MB |

- **A subscription kept its snapshot (fixed).** Since #181 merged a
  subscription's namespaces into one snapshot, the subscription kept every
  namespace's part after sending it: in metadata mode, a map copy of every
  object, for as long as the page stayed open. That was 78% of the live heap at
  20k pods. The GC lets the heap grow to twice what's live before it collects,
  so RSS kept climbing while the page sat idle. The subscription now keeps only which namespaces answered
  (`pool_snapshot_test.go`).
- **What stays live is the informer's own copy.** With the fix, 186 MB of the
  235 MB heap at 100k pods is the typed metadata client-go keeps, about 1.9 KB a
  pod, and 87 MB of that is `managedFields`. That fits the budget.
- **RSS is the sync's peak, not what the engine keeps.** Every object is turned
  into a map twice during the first sync (once as the list arrives, once for
  the snapshot), each time through a JSON round trip. The Go runtime hands the
  freed memory back to the OS slowly, so RSS is about 2 GB at sync and still
  1.85 GB three minutes later, with 226 MB live.
- **The waste sampler lists every pod in full once a minute.** One tick
  allocates 176 MB at 20k pods (`podsAndOwners`), and its first tick after sync
  added about 320 MB of RSS at 100k pods (2,040 → 2,363 MB). It lists whether
  or not anyone has the Cost page open.

What would bring RSS at 100k pods under 400 MB, each its own PR:
- Convert objects to maps per frame as the snapshot goes out, not all at once,
  and without the JSON round trip. **Done, but for the round trip:** a
  snapshot holds the informer's own objects and makes each 200-object frame's
  ops only once the frame before is written (`stream.Snapshot`). The initial
  list, which was also made maps as it arrived and sent as deltas ahead of the
  snapshot, now reaches the page only in the snapshot.
- Feed the waste sampler from the pods informer, or sample only while its page
  is open. **Done differently:** it lists 500 objects a page and totals pods
  page by page, so a tick holds one page. It still lists once a minute.
- Leave `managedFields` out of the metadata informers' store. **Done, in part:**
  every informer drops each entry's field set (`fieldsV1`, 48 of the 51 maps in
  a generated pod's metadata) as objects arrive, and keeps the entries. Of the
  readers: the Rollout tab reads when each manager wrote, which stays; Upgrade
  Readiness reads no managedFields (its comment explains why it can't); the MCP
  tools strip managedFields before they use an object.

The same 100k pods against a Kubernetes 1.34 envtest API server, RSS at sync,
10 s and 70 s after, live heap after a forced GC:

| Mode, changes | Live heap | RSS at sync | RSS 10 s | RSS 70 s |
|---|---|---|---|---|
| metadata, field sets and sampler | 140 MB | 770 MB | 833 MB | 352 MB |
| metadata, all three | 139 MB | **354 MB** | **354 MB** | **336 MB** |
| full, field sets and sampler | 772 MB | 1,399 MB | 1,722 MB | 1,727 MB |
| full, all three | 776 MB | 1,407 MB | 1,407 MB | 1,624 MB |

**Metadata mode now stays under the 400 MB budget, at sync and after.** Full
mode, which the Pods page uses and the budget doesn't cover, holds 772 MB of
cached pods as Go maps (1,482 MB before), and its RSS settles at about twice
that: Go lets the heap reach twice what's live before it collects. Bringing
that down means caching less of each pod, a design choice of its own.

## Found by measuring

- **Scrolling 100k rows ran at about 37 fps** (2026-10-22, same machine,
  p95 frame 50 ms). A CPU profile showed two causes in the Pods table: every
  Age cell's tooltip built a new date formatter (`toLocaleString` with options),
  about 40% of its JavaScript time; and the select-all box walked every row's
  key on every render, with nothing selected. With both fixed, two runs gave
  58.8 and 55.0 fps (p95 frame 16.8 and 33.3 ms).

## On your machine

Linux only (the harness reads `/proc`). Use a dedicated cluster:

```sh
kind create cluster --name kubebay-perf --kubeconfig /tmp/kubebay-perf.kubeconfig
make web-install sync-ui
(cd engine && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o bin/kubebay ./cmd/kubebay)
(cd perf && npm ci && npx playwright-core install chromium)
node perf/harness.mjs --engine engine/bin/kubebay --kubeconfig /tmp/kubebay-perf.kubeconfig \
  --context kind-kubebay-perf --out perf/perf.json
node scripts/perf-budgets.mjs --results perf/perf.json --budgets perf/budgets.json
```

Options:
- `--pods 1000,10000`: the pod counts to measure.
- `--runs 5`: cold-start runs.
- `--settle 20`: seconds to wait before idle samples. Watch samples wait half that.
- `--paint-samples 30`: pods to create for watch-to-paint.
- `--scroll-rows 100000`: rows in the scrolling table.
- `--chromium PATH`: use an installed Chromium.

## The desktop app, per release

CI doesn't measure the macOS app. Before each release, on the release build:

```sh
node scripts/desktop-cold-start.mjs /Applications/Kubebay.app/Contents/MacOS/Kubebay 5
```

The script launches the app in its smoke mode (KB-14), in which the app exits
the moment the shell reports its first painted frame. It times each launch and
prints the runs and the median. The first run starts with a cold disk cache.
Record the output, with the Mac model and macOS version, in the release notes.
