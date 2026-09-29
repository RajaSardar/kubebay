# Table and list UX: research and plan

The resource tables (Pods, Deployments, StatefulSets, Services and every other
kind under `/r/:kind`) are where Kubebay users spend most of their time. This
is an audit of them against the tools people compare Kubebay with, the fixes
that ship with it, and what should come next, ranked.

## Method

- **Code audit** of the two table implementations: `pages/Workloads.tsx`
  (Pods) and `pages/ResourceTable.tsx` (every other kind), plus the stream
  client (`lib/ws.ts`, `lib/useResourceStream.ts`) that feeds them.
- **Measured, not assumed**: the app was run against a real `kube-apiserver`
  (envtest, seeded with 5 namespaces, 11 Deployments, 20 Pods in Running,
  CrashLoopBackOff and ImagePullBackOff, 11 Services), and a browser sampled
  the DOM every 25 ms after opening each table.
- **Benchmarks**: Lens / Freelens, Headlamp, Rancher Dashboard and k9s for
  Kubernetes-specific patterns; Linear, GitHub and the Vercel dashboard for
  general data-table practice; Nielsen Norman Group's guidance on skeleton
  screens and progress indicators; WCAG 2.2 for keyboard and status semantics.

## Why the skeleton never showed (a bug, not a styling issue)

The report was "I can't see the skeleton on Pods or Deployments." The
measurement showed something worse: on a fast cluster **Pods and Deployments
could sit on their skeleton indefinitely, and StatefulSets showed the
Deployments list**.

Cause: the WebSocket client decoded binary frames (`begin`, `items`)
asynchronously via `Blob.arrayBuffer()` but handled the text `sync` frame
immediately. On a fast API server `sync` overtook its own `begin` and
`items`: the table was marked synced before any rows arrived, the late
`begin` reset it to "not synced", and the rows stayed in a buffer that was
never swapped in. That buffer survived a route change and was swapped into
the next table.

On a slow remote cluster (EKS) the frames are spread out and the race rarely
fires, which is why it went unnoticed. Separately, a table mounted after the
socket was already open never learned it was connected, so Pods never showed
"live" and never loaded CPU/memory on a second visit.

Fixed in this change: frames arrive as `ArrayBuffer`s and are handled in
arrival order (a Blob, if one ever arrives, queues everything behind it), the
re-sync buffer is cleared when the subscription changes, and a late listener
is told the socket is open. After the fix every table in the test cluster
shows data within about 30 ms.

**So on a healthy local cluster you will rarely see a skeleton: data lands in
tens of milliseconds, and that is the goal.** The skeleton now shows exactly
when there is nothing yet to show: first load of a slow cluster, a table
whose code is still loading, a drawer fetching its object.

## Loading states: the rule

| Situation | Show | Component |
| --- | --- | --- |
| A list or table with no rows yet | Its real headers over skeleton rows | `SkeletonTable` |
| Rows on screen, stream re-syncing | The rows, plus a 2px progress bar on top | `TableWrap busy` |
| A drawer, summary or YAML pane loading | Skeleton lines | `SkeletonLines` |
| A page whose code is loading | A skeleton page (header bar and lines) | `PageSkeleton` |
| A wait with no shape to sketch (detecting an operator, drawing a graph, computing costs, connecting to a cluster) | The helm spinner and what it waits for | `Spinner`, `PageLoader` |

This follows NN/g: skeletons for content whose layout is known (they shorten
perceived wait and prevent layout shift); a spinner for short waits with no
known layout; always say what is loading, for screen readers too
(`role="status"`, a label). Guard tests (`loadingStates.test.ts`,
`shellAdoption.test.ts`) keep tables off spinners and stop new hand-drawn
spinners.

## Findings

Severity: **P0** broken or misleading, **P1** a daily friction the benchmarks
have solved, **P2** polish.

| # | Finding | Where | Sev | Status |
| --- | --- | --- | --- | --- |
| 1 | Tables stuck on the skeleton; another resource's rows shown (frame-order race) | all tables | P0 | **Fixed** |
| 2 | Pods never "live", metrics never load on a second visit | Pods | P0 | **Fixed** |
| 3 | The "+" button did nothing (`onClick` was a TODO) | resource tables | P0 | **Fixed**: opens Create Resource on that kind's template; hidden where there is none |
| 4 | Pods filter was case-sensitive and only matched name/namespace | Pods | P1 | **Fixed**: case-insensitive, every word must match, name/ns/node/IP/status |
| 5 | Resource filter matched the name only | resource tables | P1 | **Fixed**: name, namespace and every shown column |
| 6 | No way to tell how many rows a filter hides | all | P1 | **Fixed**: "3 of 340" |
| 7 | No keyboard use of lists (Linear, GitHub, k9s all have it) | all | P1 | **Fixed**: `/` filter, Esc clear, ↑/↓ or j/k move, Enter open, x select |
| 8 | Sort forgotten on every visit | all | P1 | **Fixed**: remembered per table |
| 9 | Pods had no row menu or ⋮ button; Logs and Shell took three clicks | Pods | P1 | **Fixed**: View, Logs, Shell, Edit YAML, Copy name, Delete |
| 10 | "Edit YAML" opened the summary, same as "View details" | resource tables | P1 | **Fixed**: opens the YAML tab |
| 11 | Namespace pills on Pods did not filter (they do elsewhere) | Pods | P2 | **Fixed** |
| 12 | Relative ages had no exact time | all | P2 | **Fixed**: tooltip |
| 13 | A status like CrashLoopBackOff did not say why | Pods | P2 | **Fixed**: the waiting message on hover |
| 14 | Blank page while a lazily loaded page's code downloads | all routes | P1 | **Fixed**: skeleton page |
| 15 | "Loading…" text in drawers, YAML, rollout, graphs; spinner on the CRD list | drawers, CRDs | P2 | **Fixed**: skeleton lines |
| 16 | Four hand-drawn spinners, none announced to screen readers | shell | P2 | **Fixed**: one `Spinner` (the helm icon), `role="status"` |
| 17 | Pods is not virtualised: every row is in the DOM (5,000 pods = 5,000 rows) | Pods | P1 | Follow-up |
| 18 | Two table implementations (Pods and the rest) drift apart (filter, count placement, row menu, namespace pills, virtualisation and header layout all differed) | Pods, resource tables | P1 | Follow-up: one `ResourceTable` with a Pods column set |
| 19 | Ages go stale: they are computed at render, and rows only re-render on data changes | all | P1 | Follow-up: a 30 s clock for the Age column |
| 20 | CPU bar scales to 1 core and memory to 1 GiB for every pod; memory is always drawn in the warning colour | Pods | P1 | Follow-up: bar against requests/limits; accent unless near the limit |
| 21 | No column chooser (Lens, Headlamp, Rancher have one) | all | P2 | Follow-up: show/hide and reorder, remembered per table |
| 22 | Deployment row menu has no Restart / Scale, the two most common actions | Deployments, StatefulSets | P1 | Follow-up |
| 23 | Owner column is text; "show this Deployment's pods" is several clicks | workload tables | P2 | Follow-up: owner as a link, a "Pods" row action |
| 24 | Live updates are silent: a row that changes status does not draw the eye | all | P2 | Follow-up: a 1 s tint on changed rows, off under reduced motion |
| 25 | Filter has no field syntax (`ns:shop status:crash label:app=web`) | all | P2 | Follow-up |
| 26 | Bulk selection offers only Delete, at the top of the page | all | P2 | Follow-up: a bottom action bar (Linear/GitHub), "Select all 340 matching" |
| 27 | The Name column scrolls away on wide tables | all | P2 | Follow-up: sticky first column |
| 28 | Pods shows a cluster picker in its toolbar that duplicates the cluster strip | Pods | P2 | Follow-up: remove |

## Benchmark notes

- **Lens / Freelens**: dense, sortable, a column chooser per table, a row
  menu with Logs, Shell, Edit, Delete, and a details drawer. Kubebay now
  matches the row menu and drawer; the column chooser is the main gap.
- **Headlamp**: clean empty and loading states, age tooltips with exact
  times, owner links. Kubebay now matches the first two.
- **k9s**: everything from the keyboard (`/` filter, `j/k`, `Enter`, `l` logs,
  `s` shell). Kubebay's `/`, `j/k`, Enter, x follow it; `l` and `s` shortcuts
  on the active row would be a natural next step.
- **Linear, GitHub**: keyboard-first lists, filter counts, a floating
  bulk-action bar, remembered views.
- **NN/g**: skeletons for known layouts, spinners for short unknown waits,
  never a blank screen; progress feedback within 1 s.

## How it is tested

- `lib/__tests__/tableUx.test.tsx`: filter, count, age tooltip, remembered
  sort, keyboard navigation, the + button's template.
- `lib/__tests__/ws.test.ts`: frame order (including a Blob), late listeners.
- `lib/__tests__/useResourceStreamSwitch.test.tsx`: no rows leak between
  resources.
- `components/__tests__/uiSkeleton.test.tsx`, `uiSpinner.test.tsx`,
  `ClusterConnectingOverlay.test.tsx`: the components.
- `__tests__/loadingStates.test.ts`: which pages must use skeletons.
- Manually against a real API server: every table loads in about 30 ms,
  filters, counts, keyboard, row menu and the + button all work.
