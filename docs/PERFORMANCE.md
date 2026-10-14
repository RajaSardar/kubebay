# Performance: what's measured, and how

KB-02. The budgets are in [PRODUCT_REQUIREMENTS.md §6](PRODUCT_REQUIREMENTS.md#6-performance-budgets).
This page says which of them CI measures, exactly how, and what each number
leaves out. Quote a number with its date, commit and this page, or don't quote it.

## In CI: `perf (kind)`

The job runs on every pull request and on main. It works in four steps:

1. Builds the engine with the web app embedded (`make build`).
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
| **Idle** (`idle.rssMB`, `idle.cpuPercent`) | One engine, connected to the cluster, with the app open on that cluster's Overview. After 20 s: the median RSS of 5 samples a second apart, then CPU over 10 s, as a percentage of one core. |
| **Watch load** (`watch[]`) | Generate N pods (1,000, then 10,000) in `kubebay-perf`. For each N and each mode (`metadata`, `full`), start a fresh engine and connect it. Subscribe to every pod in the cluster over the WebSocket, as the Pods page does, and time from subscribing to the engine's `sync` (`syncMs`). After 10 s, take the median RSS of 5 samples. `count` is how many of the generated pods the snapshot held; a run that saw fewer doesn't count. |

What these leave out:

- **Cold start is the web shell, not the desktop app.** The browser is already
  running, so the webview's own start-up isn't in it. For the desktop app, see
  below.
- **Idle RSS is the engine alone.** The PRD's 150 MB covers the desktop shell
  and the engine together. The shell's webview isn't measured in CI.
- **Idle CPU is the engine while the app is open.** With nothing attached, a
  connected engine uses no measurable CPU; what the budget sees is the engine
  serving the open page.
- **The generated pods are lighter than real ones.** They name a scheduler that
  doesn't exist, so they stay Pending: no node, no container statuses, small
  `managedFields`. Real pods cost the engine more memory each.
- **The PRD's 100k-pod budget isn't run.** CI measures 10k. The budget file
  checks 10k against the 100k limit, which only catches gross regressions.
- **Not measured yet:**
  - watch event to painted row (p95);
  - scrolling a 100k-row table;
  - idle with three clusters connected.

## Budgets: warnings first

`perf/budgets.json` maps a metric to its limit and source. Today a metric over
its limit is a **warning**: an annotation on the run and "over" in the summary.
KB-02 step 4 flips them to failures once main has had three stable runs. A
maintainer does that by adding `--fail` to the job's Budgets step and noting the
date in `docs/BACKLOG.md`. A budget changes only through an ADR with evidence,
as the PRD says.

## On your machine

Linux only (the harness reads `/proc`). Use a dedicated cluster:

```sh
kind create cluster --name kubebay-perf --kubeconfig /tmp/kubebay-perf.kubeconfig
make build
(cd perf && npm ci && npx playwright-core install chromium)
node perf/harness.mjs --engine engine/bin/kubebay --kubeconfig /tmp/kubebay-perf.kubeconfig \
  --context kind-kubebay-perf --out perf/perf.json
node scripts/perf-budgets.mjs --results perf/perf.json --budgets perf/budgets.json
```

Options:
- `--pods 1000,10000`: the pod counts to measure.
- `--runs 5`: cold-start runs.
- `--settle 20`: seconds to wait before idle samples. Watch samples wait half that.
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
