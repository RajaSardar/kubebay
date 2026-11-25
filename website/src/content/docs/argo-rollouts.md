---
title: Argo Rollouts
description: A dashboard of your Argo Rollouts, with phase, step, canary weight, revisions and AnalysisRuns, and Promote, Skip step, Pause, Resume, Abort, Retry and Restart.
section: Integrations
order: 7
appRoutes: ["/rollouts"]
---

**Rollouts** in the sidebar's Tools is a dashboard of the cluster's [Argo Rollouts](https://argo-rollouts.readthedocs.io/). It appears only on a cluster that serves the `rollouts.argoproj.io` CRD. Kubebay reads the `Rollout` objects, their ReplicaSets and their `AnalysisRun` objects through the Kubernetes API with your kubeconfig. If you open the page by address on a cluster without Argo Rollouts, it says so.

## Searching

Above the cards, the **Filter rollouts** box narrows the list as you type; press `/` anywhere on the page to jump to it and Escape to clear it. Plain words match the name, namespace, strategy, phase, container images and revision names or numbers, and every word must match. `phase:degraded`, `ns:shop`, `name:`, `strategy:bluegreen`, `image:` and `revision:` match one field, and `label:app=web` matches a label on the Rollout itself. `"web"` or `=web` matches the whole name, and a leading `-` excludes (`-phase:healthy`). A badge beside the box reads "3 of 12" when the filter hides some. If nothing matches, the page says **No Rollouts match this filter**, which is different from "No Rollouts found on this cluster". This has been checked with component tests, not against a live cluster.

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

The **Argo dashboard** tab, next to **Rollouts** at the top of the page, shows the upstream `kubectl argo rollouts dashboard` inside Kubebay. Opening the tab starts it; leaving it stops it. Nothing runs until you open the tab.

What it needs: the `kubectl-argo-rollouts` plugin, installed by you. Kubebay looks for it on your `PATH`, then in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.krew/bin` and `~/go/bin`, and never downloads anything. If it is not found the tab explains how to install it (`brew install argoproj/tap/kubectl-argo-rollouts`, `kubectl krew install argo-rollouts`, or the releases page) and offers **Use the Rollouts view**, which is the built-in view above. The plugin must be recent enough to have `dashboard --root-path`; if not, the tab says to upgrade it.

What runs: `kubectl-argo-rollouts dashboard` on your computer, as you, bound to `127.0.0.1` on a free random port, with `--kubeconfig` set to the one kubeconfig file that defines the selected cluster's context, `--context` set to that context, and `--namespace` set when exactly one namespace is selected in the namespace filter (otherwise the tool shows all namespaces). Change the namespace selection while the tab is open and the dashboard restarts for it. Its environment is only `HOME`, `PATH`, `LANG` and that `KUBECONFIG`: no Kubebay token and no other variables, so a kubeconfig that signs in through a plugin such as `aws` or `gke-gcloud-auth-plugin` still works when that plugin is on `PATH` and its credentials are under your home folder. If the context's cluster or user is defined in a different kubeconfig file than the context, the tool may not find them; its error is shown.

How it is shown: Kubebay does not hand the page the raw port. The engine proxies the dashboard at a same-origin address with a random path token made for each run, and the page frames that address in a sandboxed frame that cannot reach Kubebay's own data. Fonts or scripts the dashboard loads from other hosts will not load. The tool's own buttons (promote, abort and the rest) act with your permissions but outside Kubebay's confirmation and [audit log](/docs/audit-log/); Kubebay records only that it started the dashboard (`rollouts-dashboard-start`, with the cluster and namespaces).

How it stops: after you leave the tab or the page it keeps running for a minute, so coming back is instant, then stops. It also stops when the cluster is disconnected, when you quit Kubebay, and about three minutes after the page stops reporting that it is open (a closed or suspended window). At most one dashboard runs per cluster and three overall. If Kubebay is killed without quitting, the next start of the engine ends the dashboard it left behind. If the dashboard does not answer within 15 seconds, the tab shows why, with the tail of the tool's own error output, and **Try again**.

Where it is not offered: only on the desktop app or an engine on your own machine. When Kubebay runs in a cluster, with OIDC sign-in or behind an auth proxy, the tab is hidden and the page says why, because the tool would run with the engine's identity instead of yours.

What has not been checked: this was tested with a stand-in plugin script, not the real `kubectl-argo-rollouts`, and never against a cluster. That the real tool accepts `--root-path` and works inside the frame, and how it looks under the frame's content policy, is unverified. Windows builds compile but the dashboard has not been run there.

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
