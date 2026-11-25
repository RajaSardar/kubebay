---
title: Argo Rollouts
description: A dashboard of your Argo Rollouts, with phase, step, canary weight, revisions and AnalysisRuns, and Promote, Skip step, Pause, Resume, Abort, Retry and Restart.
section: Integrations
order: 7
appRoutes: ["/rollouts"]
---

**Rollouts** in the sidebar's Tools is a dashboard of the cluster's [Argo Rollouts](https://argo-rollouts.readthedocs.io/). It appears only on a cluster that serves the `rollouts.argoproj.io` CRD. Kubebay reads the `Rollout` objects, their ReplicaSets and their `AnalysisRun` objects through the Kubernetes API with your kubeconfig. If you open the page by address on a cluster without Argo Rollouts, it says so.

## Searching

Above the cards, the **Filter rollouts** box narrows the list as you type; press `/` anywhere on the page to jump to it and Escape to clear it. Plain words match the name, namespace, strategy, phase, container images and revision names or numbers, and every word must match. `phase:degraded`, `ns:shop`, `name:`, `strategy:bluegreen`, `image:` and `revision:` match one field. `"web"` or `=web` matches the whole name, and a leading `-` excludes (`-phase:healthy`). A badge beside the box reads "3 of 12" when the filter hides some. If nothing matches, the page says **No Rollouts match this filter**, which is different from "No Rollouts found on this cluster". This has been checked with component tests, not against a live cluster.

## What each Rollout shows

- The name, which opens the Rollout's detail, the namespace, a **phase** pill (Healthy, Progressing, Paused, Degraded or Aborted) and the strategy, **canary** or **blueGreen**.
- For a canary, **step N of M** from `status.currentStepIndex` and the strategy's steps, and the traffic split as **N% canary** and **N% stable**. The split is the controller's own `status.canary.weights` when it reports one, otherwise the last `setWeight` step already completed.
- **desired / updated / ready / available** replicas.
- The **stable revision** and the **canary revision**: the ReplicaSet's name, its `rollout.argoproj.io/revision` and its container images. There is no canary line when the new version is already the stable one.
- When it is paused, **Paused:** and the reason or message, such as `CanaryPauseStep`.
- Each AnalysisRun the Rollout owns, with its phase.

## The Release view

Each Rollout's card ends with a **Release** row. Click it to open a view of how the release is going, built from what the page already reads (the Rollout, its ReplicaSets and AnalysisRuns) plus the namespace's Services:

- The **phase**, the strategy and the controller's message, and in bold why it is halted: **Paused:** with the pause reasons (and "paused by a user" for **Pause**), or **Aborted:** with the abort message and the failed AnalysisRun, if there is one.
- For a canary, every **step** with its state (done, current or pending), the current one marked **paused** at a pause step and **aborted** after an abort. Once the index passes the last step every step shows done.
- The **ReplicaSets** the Rollout owns, matched by owner UID: role (stable, canary, or active and preview for a blueGreen; older revisions as previous), name, revision, images, ready over desired pods and, for a canary, the traffic weight. A weight is labelled **live** when the controller reports it in `status.canary.weights` and **target** when Kubebay only knows the step's `setWeight` (with no traffic router the real split follows the pod counts). A blueGreen shows no weights.
- The **Services**: the active and preview Services of a blueGreen, with the revision each one selects when its selector carries the `rollouts-pod-template-hash` label, and the stable and canary Services of a canary. A Service that is not in the namespace says **not found**. If you may not list Services, the view says they are not available to you and shows the names only.
- Each **AnalysisRun**, newest first, with its phase and, per metric, the phase, the counts of successful, failed, inconclusive and errored measurements, the last measurement's value and, for a failed, errored or inconclusive metric, the failure message.
- The Rollout's **conditions**.

This is read-only, and the actions stay in the card's header above it. The view reads only a fixed set of fields. AnalysisRun arguments, provider settings and secret references are never shown. Text that controllers and metric providers write (messages and measurement values) is cut to 200 characters and shown as plain text. Field shapes follow the Rollout, ReplicaSet, AnalysisRun and Service resources and were checked against hand-written examples, not against a live cluster. The Rollout's drawer does not have the Release view yet: it has no ReplicaSet or AnalysisRun streams of its own.

## Argo's own dashboard

Kubebay does not embed or start Argo's `kubectl argo rollouts dashboard`. Shipping that binary would mean one more program to build, sign and update, it would use your kubeconfig rather than Kubebay's per-user permissions, and it would not work when Kubebay runs inside a cluster. The Release view covers the same questions natively. In the desktop app only, a note at the top of this page shows the command `kubectl argo rollouts dashboard` with a **Copy** button for people who want the upstream UI as well. It runs nothing, does not check whether the plugin is installed, and the command never includes a Rollout's name or namespace.

## Actions

Each Rollout offers the actions that make sense for its state. They go through the same path as an edit in the YAML tab: a JSON merge patch with your own permissions, written to the [audit log](/docs/audit-log/). On a cluster whose name looks like production, Kubebay asks first on this page.

| Action | Shown | Patch | Confidence |
| --- | --- | --- | --- |
| **Promote** | not aborted, not Healthy | `status.pauseConditions: null` on the status subresource, then `spec.paused: false` | Follows what `kubectl argo rollouts promote` sends. Not tested against a live cluster. |
| **Promote fully** | not aborted, not Healthy | the same, plus `status.promoteFull: true` | As above. |
| **Skip step** | canary, not aborted, not Healthy, not past the last step | `status.currentStepIndex` set to the next step, on the status subresource | Follows `kubectl argo rollouts promote --skip-current-step`. The patch carries the `resourceVersion` it was worked out from, when Kubebay has it, so a Rollout that moved on in the meantime refuses it instead of going back a step. Not tested against a live cluster. |
| **Pause** | not aborted, not Healthy, not already paused by you | `spec.paused: true` | Follows `kubectl argo rollouts pause`. Not tested against a live cluster. |
| **Resume** | in place of Pause when `spec.paused` is true | `spec.paused: false` | The spec half of Promote. It leaves a step's own pause in place, so it undoes a Pause without also passing a pause step; use Promote for that. Not tested against a live cluster. |
| **Abort** | not aborted, not Healthy | `status.abort: true` on the status subresource | Follows `kubectl argo rollouts abort`. Not tested against a live cluster. |
| **Retry** | aborted | `status.abort: false` on the status subresource | Follows `kubectl argo rollouts retry rollout`. Not tested against a live cluster. |
| **Restart** | always (after a second click: **Confirm restart?**) | `spec.restartAt` set to now | Documented Rollout field. Not tested against a live cluster. |

The Rollout CRD has a status subresource since Argo Rollouts v1.0, and the API server ignores `status` fields sent to the Rollout itself, so Kubebay writes them to the status subresource. On an older install without one, the API server answers Not Found and Kubebay writes them to the Rollout itself, as the kubectl plugin does. The audit entry says `subresource=status` when the status subresource took the patch.

A Rollout's drawer, whether you open it from this page or from **Custom Resources → Rollouts**, has the same actions, again only those that fit its state: **Promote**, **Promote fully**, **Skip step**, **Pause** or **Resume**, **Abort**, **Retry** and **Restart**. In the drawer **Promote fully**, **Skip step**, **Abort** and **Restart** ask for a second click (the button turns into **Confirm …?**).

The page has the namespace filter like the other lists, and only lists the namespaces you chose. If your identity may not list Rollouts, the page says so and gives the API server's reason, and when only some of the chosen namespaces are refused a banner names them. The count beside the title shows once the list has loaded.

## Not here yet

Argo Workflows and Argo Events have no pages of their own. Their objects are listed under **Custom Resources** in the sidebar.
