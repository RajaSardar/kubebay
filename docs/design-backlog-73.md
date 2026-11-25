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

## Challenge round

Checked against `lib/rollouts.ts`, `components/RolloutsDashboard.tsx`, `pages/Rollouts.tsx` and the existing desktop detection. Each point states the objection and the final decision.

1. **Ownership: the plan says UID match, the existing helper matches kind and name.** `ownedBy` in `rollouts.ts` compares `ownerReferences[].kind/name` only. A Rollout deleted and recreated under the same name would adopt stale ReplicaSets and AnalysisRuns that are still being garbage collected. Decision: `buildReleaseView` matches on `metadata.uid` when both the Rollout and the ownerReference carry one, and falls back to kind and name only when a UID is absent (fixtures, partial objects). Export one shared `ownedBy` from `rollouts.ts` with that behaviour, so `describeRollout` and the release view cannot disagree. Add a regression test with a same-name, different-UID ReplicaSet.

2. **"The component calls the existing confirm and audit flow" is not true: that flow is inline state in `RolloutsDashboard`.** `run`, `request`, `busy`, `error` and `confirming` live inside the dashboard component, and the production-cluster confirmation is `useClusterLooksProduction` there. A second component cannot call it. Decision: extract a `useRolloutActions(cluster, rolloutGvr)` hook (returns `run`, `request`, `busy`, `error`, `confirming`, `confirm`, `cancel`) first, as a behaviour-preserving refactor covered by the existing `RolloutsDashboard.test.tsx`, then use it from both the dashboard row and the release view. Restart keeps `ArmedButton` and `RESTART_CONFIRM_LABEL`; `restartGuard` stays unmodified. No new mutation path and no Go change, so audit is untouched (the apply endpoint already records user and gvr). Scope trap avoided: do not rewrite the action code in the new component.

3. **Services stream does not exist on the Rollouts page, and the drawer has no streams at all.** `pages/Rollouts.tsx` streams Rollouts, ReplicaSets and AnalysisRuns only. The generic drawer for the `ext--` kind has no stream props. "Reuse the existing Services stream" would mean a new subscription. Decision: the view takes `services` as an optional input. The Rollouts page adds one Services stream scoped to the user's selected namespaces, through the same stream hook and RBAC path as the other three (a forbidden result yields the "not available to you" note). Services appear only for blueGreen, where the active and preview names are known; for canary the stable and canary Service names are shown as names without a selector lookup. The drawer reuses the page's already-loaded rows by rendering the release view from the Rollouts page expand row, not by adding streams to the drawer.

4. **Drawer placement is underspecified and risky.** Wiring a "Release" tab into the generic drawer's extension branch would touch shared drawer code for one CRD. Decision: primary placement is an expandable row on `RolloutsDashboard` (data is already there). The drawer gets a Release section only if the drawer already receives sibling rows; otherwise it links back to the Rollouts page row. Docs say exactly where the view lives. This shrinks the first slice and keeps drawer tests untouched.

5. **Desktop detection helper is not a single obvious thing.** `lib/nativeWindow.ts`, `lib/updates.ts` and `lib/smoke.ts` each check for Tauri. Decision: reuse whichever one `updates.ts` exports for "running in the desktop app" (confirm by reading it during implementation) and import it; do not add a fourth check. The hint test mocks that one function.

6. **Security refinements.** (a) Measurements: render only `name`, `phase`, counts, `message` and the last measurement's `value`, each truncated to 200 characters, as text nodes. Do not render `metadata`, `args`, `provider` specs or `secretKeyRef`, and do not iterate unknown keys generically. (b) Argo hint card: the command is a fixed constant, but the Rollout name and namespace must not be interpolated into it (shell-injection through a hostile resource name when copied). The card shows `kubectl argo rollouts dashboard` only. (c) The "abort reason" must come from `status.message` and `pauseConditions[].reason`, which any controller can write; treat as untrusted text, truncated, never HTML. (d) Statement "A stream the user cannot read yields an empty section" requires distinguishing forbidden from loading, so the model input carries a per-source `{rows, forbidden}` state, not bare arrays.

7. **Step state is wrong for edge cases in the plan.** `currentStepIndex` equal to the step count means the canary finished its steps, so all steps are `done` and none `current`. A `setWeight`, `pause` or `analysis` step can also be skipped by "Skip step", which only increments the index, so earlier steps are `done` regardless of how they ended. Aborted rollouts reset `currentStepIndex` on the controller side in some versions; the model must still show the abort and not invent a current step. Decision: add these three cases to the test plan. When `status.abort` is true, mark the step at the index `current` with an "aborted" note only if the index is in range.

8. **Weight fallback is a guess.** "Falling back to the last `setWeight`" can show a weight the traffic router is not applying (no router configured means weights follow replica ratios). Decision: prefer `status.canary.weights`; else, for the no-router case, show the last `setWeight` at or before the current step and label it "target", not "live". Never show a weight for blueGreen. Test both labels.

9. **Testability.** The plan's component test for "hint card only on desktop" needs the desktop helper injected; the Playwright screenshot is not a test. Decision: the screenshot is evidence only; the guard and unit tests above are the gate. `ReleaseView` fixtures are built from small hand-written Rollout, ReplicaSet and AnalysisRun objects in a `fixtures` section of the test file (no live cluster), and the docs and CHANGELOG say plainly that field shapes follow the CRD and were not verified on a live cluster.

10. **Scope trap: the Public API type list is too large for a first slice.** Decision on slicing, in order, each its own commit with tests first: (1) shared `ownedBy` plus `useRolloutActions` extraction (no visible change); (2) `rolloutRelease.ts` steps, ReplicaSets, conditions and halt reason; (3) AnalysisRun metrics; (4) blueGreen Services with the stream; (5) component and expandable row; (6) desktop hint, docs, CHANGELOG, `whatsnew-gen`. `ReleaseService.selectsRevision` is dropped from v1: deriving it needs the Service selector matched against the `rollouts-pod-template-hash` label, which is reliable only for blueGreen; keep it only there and omit otherwise.

### Final decisions (summary)

- UID-first ownership via one shared helper, with a same-name regression test.
- Extract `useRolloutActions` from `RolloutsDashboard` before building anything new; no new mutation path, no Go change.
- Services are an optional, RBAC-scoped stream added on the Rollouts page, blueGreen only for selector lookup.
- Primary placement is the expandable row; the drawer is secondary and only if it needs no new streams.
- Reuse the single existing desktop check; the hint is a constant string with no interpolation.
- Strict field allowlist and truncation for AnalysisRun and status text; forbidden is distinct from loading.
- Edge-case step states and the "target versus live" weight label are in the test plan.
- Six small commits in the order above.

Note: the decision above not to embed or start the upstream dashboard was superseded by backlog 87 (`design-backlog-87.md`): the Rollouts page now has an Argo dashboard tab on the desktop. The Release view stays.
