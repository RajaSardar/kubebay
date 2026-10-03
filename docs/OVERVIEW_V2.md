# Workloads Overview v2

Decision record for the blocks added to the Workloads Overview tab. Everything the tab already had (the per-kind cards and the Pressure, SPOF Radar and Service Health views) stays; v2 only adds.

## How it was decided

An eight-person panel debated it over three rounds (opening pitches, cross-examination, final stand) before a ruling:
- Kubernetes: an on-call SRE and a platform engineer running 40 clusters.
- Non-Kubernetes tech: a backend developer and an engineering manager.
- Design and analytics: a product designer and a data-viz lead.
- Two self-declared lazy engineers.

The transcript is in the "Overview Arena" artifact.

## What was built, top to bottom

1. **Health verdict line.** Word, icon and colour; a count with its denominator ("4 of 612 pods"); a direction from the last hour of warning events ("worse than 30 min ago"); "+N outside your namespaces" when a namespace scope is on; a capacity warning past 85% requested.
2. **Needs attention** (the focal point; `lib/attention.ts`, `components/NeedsAttention.tsx`). One row per broken workload, worst first:
   - what broke in plain words, with the Kubernetes term kept beside it;
   - ready of desired, restarts, when it started;
   - Show pods and Show logs;
   - the worst pod's last log line, from the run that crashed when it has restarted, for the top five rows only (`lib/lastLogLine.ts`), so a wide outage does not open a log stream per pod. It renders nothing when there is no line (an image that never pulled).
   Node trouble and Unschedulable show up as the reason in the row they hurt, not as a node grid. When nothing is broken it is a calm empty state with the time of the last check.
3. **Rollouts in progress.** Shown only while something is rolling out. A stalled rollout turns red and says why.
4. **Pod status bar.** One zero-based stacked bar, each segment labelled with its count and word; a segment opens Pods filtered by status (`/workloads?q=status:…`).
5. The existing per-kind cards.
6. **Capacity line.** One line of text: requested of allocatable for CPU and memory, from pod specs and node status, so it needs no metrics-server. It expands into bars, with a used layer when metrics-server is present.
7. **Namespaces ranked**, below the fold: by broken pods plus warnings, with requests as a sort option.
8. **In the workload drawer** (Summary tab of a Deployment, StatefulSet or DaemonSet): the workload's warnings over the last hour, which is as long as events live, as twelve zero-based 5-minute bars with the answer in words: "new, first 4 min ago", "started 30 min ago" or "going on all hour" (`lib/workloadWarnings.ts`, `components/WarningSparkline.tsx`). It counts warnings on the workload, on the pods its selector picks and, for a Deployment, on its ReplicaSets, and spreads a repeated event's count over the time it repeated. It renders nothing when there were none.

Not built yet: the 7-day chip. Recorded history holds CPU and memory per namespace, not warnings or broken pods, so there is nothing yet to say whether a workload's trouble is chronic over a week.

## Ruled out

- **Trends 24h/7d as a panel.** It is blank without history recording.
- **A node condition grid.** It is noise at 200 nodes; node problems show up in the rows instead.
- **Per-row sparklines.** Flat when healthy and "red confetti" when broken.
- **A standalone warning-events strip on this tab.** Its signal feeds the verdict's direction; the full strip stays on Timeline.

## Rules every block follows

- It works on a fresh cluster with no setup. A block whose data is missing does not render; nothing shows an empty chart or a setup prompt.
- Every count shows its denominator, and scales are zero-based.
- Every block leads somewhere: a filtered Pods list, a workload's pods, or a pod's logs.
- Status colour always sits next to its word.
