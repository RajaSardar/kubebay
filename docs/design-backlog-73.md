# Design note: backlog 73, Rollout release view

## Goal

Give every Argo Rollout a native "Release" view inside Kubebay that answers what
`kubectl argo rollouts dashboard` answers: where is this release, what is it
waiting on, is it healthy, and what can I do about it.

Decision already taken: Kubebay does NOT bundle, sign or spawn the upstream
binary. Reasons (also stated in the docs): no extra binary to ship or sign,
reads and writes use each user's own RBAC, and it works the same in-cluster.

The view shows:

- Strategy (canary or blueGreen).
- The step list, with the current step highlighted and pause states marked.
- Stable and canary ReplicaSets: revision, images, ready/desired pods, traffic weight.
- For blueGreen, the active and preview Services and which ReplicaSet each selects.
- AnalysisRuns with per-metric phase, measurement summary and failure reasons.
- Conditions and the abort/pause reason.
- The existing actions (Promote, Promote fully, Pause, Resume, Skip step, Abort,
  Retry, Restart).
- Desktop only: a small hint card showing `kubectl argo rollouts dashboard` to copy.

## What already exists (do only the gap)

- `lib/rollouts.ts`: `detectRollouts`, `rolloutStrategy`, `rolloutPhase`,
  `rolloutTone`, `canaryWeights`, `describeRollout` (summary only: step n/m,
  stable/canary revision, AnalysisRun phase), `availableRolloutActions`,
  `rolloutActionRequests`, `ROLLOUT_ACTION_LABELS`.
- `components/RolloutsDashboard.tsx`, `RolloutLine.tsx` (Rollouts page rows),
  `RolloutProgress.tsx` (Deployment progress, not ours).
- Streams for Rollouts, ReplicaSets and AnalysisRuns used by the dashboard.
- `restartGuard` test and the restart confirmation, the existing action flow.

Gaps: the full step list with state, pod counts per ReplicaSet, Services,
per-metric AnalysisRun detail, conditions, a release timeline component, and
the drawer placement.

## Data sources (no new endpoints)

- Rollout object (`spec.strategy`, `status.*`, `status.conditions`,
  `status.pauseConditions`, `status.canary.weights`, `status.blueGreen`).
- ReplicaSets owned by the Rollout (UID match), already streamed.
- AnalysisRuns owned by the Rollout: `status.phase`, `status.message`,
  `status.metricResults[]` (`name`, `phase`, `count`, `successful`, `failed`,
  `inconclusive`, `error`, `message`, `measurements[]`). Read-only.
- Services in the Rollout namespace, matched by name from
  `spec.strategy.blueGreen.activeService` / `previewService` and canary
  `stableService` / `canaryService`. Reuse the existing Services stream; if it
  is not loaded for that namespace, show the names only.

## Module layout

- `web/apps/shell/src/lib/rolloutRelease.ts` (new, pure, no React, no fetch).
  Imports small helpers from `lib/rollouts.ts`; if `rec/str/arr/num` need
  sharing, extract them rather than copy.
- `web/apps/shell/src/lib/__tests__/rolloutRelease.test.ts`.
- `web/apps/shell/src/components/RolloutRelease.tsx` (new): renders the model
  using `@kubebay/ui` primitives and `--kb-*` tokens only. Reuses
  `rolloutTone` for tone mapping; no new colours planned.
- `web/apps/shell/src/components/RolloutArgoHint.tsx` (new, tiny): desktop-only
  copy card. Gate on the existing desktop detection helper.
- Wire into the Rollout drawer (a "Release" tab or section in the generic
  drawer's Rollout branch) and as an expandable row on `RolloutsDashboard`.
- Docs: `website/src/content/docs/argo-rollouts.md`, `resource-details.md`;
  `CHANGELOG.md` [Unreleased] under Added; then `node scripts/whatsnew-gen.mjs`.
  No new `<Route>`, so no new docs page or help.ts entry; if help text for
  `/rollouts` changes it stays within the 170-char limit.

## Public API and types

```ts
type StepState = "done" | "current" | "pending";
interface ReleaseStep { index: number; kind: string; label: string; state: StepState; paused: boolean; pauseReason?: string }
interface ReleaseReplicaSet { name: string; revision: string; images: string[]; role: "stable"|"canary"|"active"|"preview"|"previous"; ready: number; desired: number; weight: number | null }
interface ReleaseService { role: "active"|"preview"|"stable"|"canary"; name: string; selectsRevision?: string }
interface ReleaseMetric { name: string; phase: string; tone: StatusTone; summary: string; lastValue?: string; failure?: string }
interface ReleaseAnalysis { name: string; phase: string; tone: StatusTone; message: string; metrics: ReleaseMetric[] }
interface ReleaseCondition { type: string; status: string; reason: string; message: string; tone: StatusTone }
interface ReleaseView { strategy; phase; tone; message; steps; replicaSets; services; analyses; conditions; haltReason: string | null; actions: RolloutAction[] }
function buildReleaseView(ro: Obj, replicaSets: Obj[], analysisRuns: Obj[], services: Obj[]): ReleaseView;
```

Actions are not reimplemented: the component calls `availableRolloutActions`
and `rolloutActionRequests` and uses the existing confirm + audit flow.

## Security considerations

- Read paths use the streams the user's own credentials already permit. No new
  endpoint, no wider list scope. A stream the user cannot read yields an empty
  section with a "not available to you" note, never a fallback fetch.
- No Secret values: the view never reads Secrets. AnalysisRun measurements can
  carry arbitrary provider output, so values are truncated, rendered as text
  (never HTML), and args/`secretKeyRef` are not shown at all.
- Mutations go only through `rolloutActionRequests` and the existing audit path
  (`audit.RecordCtx` with user and gvr). Restart keeps its confirmation;
  `restartGuard` is not weakened. Abort and Promote full keep their current
  confirmation on production-looking clusters.
- Per-user data stays per-user on a shared engine; the new code stores nothing
  server-side. No localStorage beyond the existing expand state.
- Argo hint card spawns nothing, probes nothing, shows a fixed string with a
  copy button. Docs state that it does not detect whether the plugin exists.

## Test plan (TDD, tests first)

`rolloutRelease.test.ts` with fixtures:

- Canary with steps: current index maps to done/current/pending; step kinds and
  labels; last step; `currentStepIndex` missing or past the end.
- Paused at a pause step with `pauseConditions`; indefinite pause vs duration;
  `spec.paused` set by the user.
- Aborted rollout: `haltReason` names the abort and the AnalysisRun that
  failed it, when there is one.
- ReplicaSet ownership by UID, role assignment (stable/canary/previous),
  pod counts, images, revision annotation; traffic weights from
  `status.canary.weights` falling back to the last `setWeight`.
- blueGreen: active/preview from `status.blueGreen`, Service lookup, missing
  Service, no steps.
- AnalysisRun metrics: Successful, Failed, Inconclusive, Error, Running,
  no measurements, long values truncated, only the owning Rollout's runs.
- Conditions ordering and tones; malformed or empty objects never throw.

Component tests (`RolloutRelease.test.tsx`): highlights the current step,
shows failure reason, renders actions from `availableRolloutActions`, restart
still opens the confirmation, hint card only on desktop and shows the exact
command. Guard tests (`shellAdoption`, `themeTokens`, `themeContrast`,
`cssHygiene`, `help.test`, `restartGuard`) run unmodified. Headless Playwright
mock harness for a screenshot into `/tmp/kubebay-work/`.

## Failure modes

- Argo Rollouts CRD absent or old: model returns `strategy: "unknown"` and the
  view collapses to the summary; no crash.
- AnalysisRun CRD missing or stream not permitted: analyses empty, note shown.
- Stale or partial streams (ReplicaSet not yet seen): role marked unknown,
  pod counts omitted rather than guessed.
- Templates with `templateName` or `args` we do not understand: step label
  falls back to its kind.
- Experiment, header-route and traffic-router specifics: shown as generic
  steps, never interpreted.

## Out of scope

- Bundling, spawning, proxying or detecting the upstream dashboard or plugin.
- Creating or editing Rollouts, AnalysisTemplates or Experiments.
- Live metric graphing or querying metric providers (Prometheus, Datadog).
- Any live-cluster verification in this lane: actions and field shapes follow
  the CRD and the existing tests, and the docs will say they were not run
  against a live cluster.
