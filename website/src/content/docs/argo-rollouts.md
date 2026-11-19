---
title: Argo Rollouts
description: A dashboard of your Argo Rollouts, with phase, step, canary weight, revisions and AnalysisRuns, and Promote, Abort, Retry and Restart.
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
| **Promote** | not aborted, not Healthy | `spec.paused: false` and `status.pauseConditions: null` | Follows what `kubectl argo rollouts promote` sends. Not tested against a live cluster. |
| **Promote fully** | not aborted, not Healthy | the same, plus `status.promoteFull: true` | As above. |
| **Abort** | not aborted, not Healthy | `status.abort: true` | As above. |
| **Retry** | aborted | `status.abort: false` | As above. |
| **Restart** | always | `spec.restartAt` set to now | Documented Rollout field. Not tested against a live cluster. |

Not offered: **skip the current step** (`status.currentStepIndex`) and **Pause**, because the patch Kubebay would send for them wasn't verified. Use `kubectl argo rollouts` for those.

The `status` fields are written on the Rollout itself, as the kubectl plugin does. If your Rollout CRD has the status subresource turned on, the API server ignores them and the action does nothing.

## Not here yet

Argo Workflows and Argo Events have no pages of their own. Their objects are listed under **Custom Resources** in the sidebar.
