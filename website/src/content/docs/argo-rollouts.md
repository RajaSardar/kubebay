---
title: Argo Rollouts
description: A dashboard of your Argo Rollouts, with phase, step, canary weight, revisions and AnalysisRuns, and Promote, Skip step, Pause, Resume, Abort, Retry and Restart.
section: Integrations
order: 7
appRoutes: ["/rollouts"]
---

**Rollouts** in the sidebar's Tools is a dashboard of the cluster's [Argo Rollouts](https://argo-rollouts.readthedocs.io/). It appears only on a cluster that serves the `rollouts.argoproj.io` CRD. Kubebay reads the `Rollout` objects, their ReplicaSets and their `AnalysisRun` objects through the Kubernetes API with your kubeconfig. If you open the page by address on a cluster without Argo Rollouts, it says so.

## What each Rollout shows

- The name, which opens the Rollout's detail, the namespace, a **phase** pill (Healthy, Progressing, Paused, Degraded or Aborted) and the strategy, **canary** or **blueGreen**.
- For a canary, **step N of M** from `status.currentStepIndex` and the strategy's steps, and the traffic split as **N% canary** and **N% stable**. The split is the controller's own `status.canary.weights` when it reports one, otherwise the last `setWeight` step already completed.
- **desired / updated / ready / available** replicas.
- The **stable revision** and the **canary revision**: the ReplicaSet's name, its `rollout.argoproj.io/revision` and its container images. There is no canary line when the new version is already the stable one.
- When it is paused, **Paused:** and the reason or message, such as `CanaryPauseStep`.
- Each AnalysisRun the Rollout owns, with its phase.

## Actions

Each Rollout offers the actions that make sense for its state. They go through the same path as an edit in the YAML tab: a JSON merge patch with your own permissions, written to the [audit log](/docs/audit-log/). On a cluster whose name looks like production, Kubebay asks first.

| Action | Shown | Patch | Confidence |
| --- | --- | --- | --- |
| **Promote** | not aborted, not Healthy | `status.pauseConditions: null` on the status subresource, then `spec.paused: false` | Follows what `kubectl argo rollouts promote` sends. Not tested against a live cluster. |
| **Promote fully** | not aborted, not Healthy | the same, plus `status.promoteFull: true` | As above. |
| **Skip step** | canary, not aborted, not Healthy, not past the last step | `status.currentStepIndex` set to the next step, on the status subresource | Follows `kubectl argo rollouts promote --skip-current-step`. The patch carries the `resourceVersion` it was worked out from, when Kubebay has it, so a Rollout that moved on in the meantime refuses it instead of going back a step. Not tested against a live cluster. |
| **Pause** | not aborted, not Healthy, not already paused by you | `spec.paused: true` | Follows `kubectl argo rollouts pause`. Not tested against a live cluster. |
| **Resume** | in place of Pause when `spec.paused` is true | `spec.paused: false` | The spec half of Promote. It leaves a step's own pause in place, so it undoes a Pause without also passing a pause step; use Promote for that. Not tested against a live cluster. |
| **Abort** | not aborted, not Healthy | `status.abort: true` on the status subresource | Follows `kubectl argo rollouts abort`. Not tested against a live cluster. |
| **Retry** | aborted | `status.abort: false` on the status subresource | Follows `kubectl argo rollouts retry rollout`. Not tested against a live cluster. |
| **Restart** | always | `spec.restartAt` set to now | Documented Rollout field. Not tested against a live cluster. |

The Rollout CRD has a status subresource since Argo Rollouts v1.0, and the API server ignores `status` fields sent to the Rollout itself, so Kubebay writes them to the status subresource. On an older install without one, the API server answers Not Found and Kubebay writes them to the Rollout itself, as the kubectl plugin does. The audit entry says `subresource=status` when the status subresource took the patch.

A Rollout's drawer has **Pause**, **Resume** and **Skip step** too, beside **Restart**. **Skip step** there asks for a second click.

## Not here yet

Argo Workflows and Argo Events have no pages of their own. Their objects are listed under **Custom Resources** in the sidebar.
