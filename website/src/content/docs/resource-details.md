---
title: Resource details
description: A resource's drawer. Its summary and owners, rollout and timeline, autoscaling, policy findings, events, the YAML editor and its actions.
section: Clusters and resources
order: 4
appRoutes: ["/detail/:kind/:ns/:name"]
---

Click a row in any [resource table](/docs/resources/) to open its drawer. Every kind opens in this drawer on the right, as pods do, and a shared link to a resource opens the same drawer over its list. A drawer closes with <kbd>Esc</kbd>, the **×**, or a click anywhere outside it.

- **Copy name**, a large button right after the title, copies the resource's name (without its namespace) to the clipboard and shows **Copied** for a moment.
- **Split view** (<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd>) shows two tabs side by side, such as Events beside YAML. Drag the divider to resize them. Kubebay remembers the split for each kind.

## Tabs

Every resource has **Summary**, **YAML** and **Events**. Workloads get more.

| Tab | For | Shows |
|---|---|---|
| Summary | all | Created, labels, annotations, conditions, and **Owned by**: every owner up the chain, each a link |
| Rollout | Deployments, StatefulSets, DaemonSets | Ready replicas per revision, new against old, so a stuck rollout shows which ReplicaSet it's stuck on |
| Timeline | Deployments, StatefulSets, DaemonSets | Events, rollout revisions (with image and change-cause), condition changes, container terminations and the changes you made through Kubebay (its audit log) on one timeline. The **All**, **Events**, **Audit** and **Rollouts** buttons filter it, the time column shows how long ago with the exact time on hover, and each object name opens that object. The audit entries match by cluster, namespace and name |
| Autoscaling | Deployments, StatefulSets | Every HPA, VPA and KEDA ScaledObject that targets it, with min, max and current. **New ScaledObject** creates one. See [KEDA](/docs/keda/) |
| Policy | all but policy reports | Kyverno or other PolicyReport findings for this object. Passing checks are counted, not listed |
| Vulnerabilities | Deployments, StatefulSets, DaemonSets | How many CVEs Trivy-Operator found in its images, with a link to them on the [Vulnerabilities](/docs/vulnerabilities/) page |
| Signatures | Deployments, StatefulSets, DaemonSets | Whether its images are signed, checked on request |
| YAML | all | The live object, editable |
| Events | all | Its recent events |

Services have **Summary** (ports, selector, traffic) and **YAML**. Nodes have their own tabs: see [Nodes](/docs/nodes/). Pods have their own drawer: see [Pods](/docs/pods/).

## Actions

Above the tabs:

- **Deployments and StatefulSets**: set the replicas with **−** and **+**, then **Apply scale**. **Restart** rolls the pods.
- **Argo Rollouts**: the same **−**, **+** and **Apply scale** set a Rollout's replicas, and **Restart** replaces its pods following its strategy by setting `spec.restartAt` (the same as Restart on the Rollouts page).
- **DaemonSets**: **Restart**.
- **Owner column**: ReplicaSets show **Owner** (the Deployment, or a custom controller such as an Argo `Rollout`, that controls them; — for a bare one). Every other list can show it from the column chooser (hidden by default; Events have none), which is how a Job shows its CronJob. It is the Kubernetes controller, not the GitOps app (that is **Managed by**). Each owner links to its drawer, and the filter takes `controller:deployment`.
- **CronJobs**: the list has a **Status** column (Suspended, Active when jobs are running, or Idle) and an **Active Jobs** count beside **Last Schedule**. **Next Schedule** shows when it will next run ("in 12m"); hover for the exact time. It reads the schedule (lists, ranges, steps, month and day names, `@daily` and the other `@` shortcuts) in the CronJob's `timeZone`, or UTC when none is set, and shows – when the CronJob is suspended or its schedule is invalid. **Trigger now** runs a Job from it at once. **Suspend** and **Resume** stop and restart its schedule.
- **Nodes**: **Cordon**, **Uncordon** and **Drain**. See [Nodes](/docs/nodes/).
- **Delete**, with a confirmation.

**What this affects.** Before you delete a workload, Pod or Node, scale a workload down, restart it, or drain a Node, the confirmation has a collapsed **What this affects** line. In the drawer it appears under **Apply scale** as soon as **−** takes the count below the current one. Open it to see, from the data Kubebay already streams: the ReplicaSets and Pods involved, Services whose only backing Pods would go (they would lose all endpoints) and the Ingresses and HTTPRoutes that reach them, HorizontalPodAutoscalers aimed at the workload, PodDisruptionBudgets that cover the Pods (flagged when they would be violated or block a drain), PersistentVolumeClaims in use (the data is kept), and Pods with no controller that nothing will recreate. Each list shows up to five names and a count of the rest.

A scale down to a count above zero (for example 5 to 2) lists the Pods that would go: a StatefulSet's highest ordinals, or for a Deployment the ones its controller picks first (unscheduled, then not ready, then the newest), so treat those names as likely rather than certain. It also lists Services left with fewer ready endpoints, shown as `web (5 → 2 ready)`, and flags a Service that would have none. A PodDisruptionBudget is flagged when the new count would leave it below a numeric `minAvailable` (a budget does not block a scale down, so nothing stops it). A HorizontalPodAutoscaler aimed at the workload is flagged because it sets the replica count itself and may undo the change, and when its `minReplicas` is above the new count the preview says it will scale back up to at least that. A StatefulSet whose `persistentVolumeClaimRetentionPolicy.whenScaled` is `Delete` has its claims flagged, since their data goes with the Pods.

Deleting several selected rows at once (**Delete N selected** in a resource table) shows one **What this affects** for the whole selection: it says how many are selected, adds up the ReplicaSets, Pods, Services, budgets and claims across all of them, counts an object they share once, and judges Services against the whole selection, so two Deployments that together back a Service show it losing all endpoints. When the selection spans namespaces the names carry their namespace, as `shop/web`. A part Kubebay cannot read, for example because RBAC forbids it, says unknown instead of guessing. On a cluster whose name looks like production a warning shows above it. It is advisory: it never blocks the action, and the API server still decides.

Changes are recorded in the [Audit Log](/docs/audit-log/).

## YAML

The YAML tab is an editor for the live object.

- **Dry-run** sends your change to the API server without saving it. **diff view** then compares the live object with what the server would store, including defaults and webhook changes. Without a dry-run, it compares your edits with the original.
- **Apply** sends only the fields you changed, as a patch, not the whole object.
- **Revert** throws your edits away. **Reload** fetches the latest version from the cluster.
- On a cluster whose name reads like production (`prod`, `prd`, `live`, `production`, the same name check the [terminal](/docs/terminal/#contexts-that-read-like-production) uses), **Apply** asks **Apply to production?** first, and applies only when you choose **Apply to …**. **Dry-run** never asks. It is a check of the name only: Kubebay can't tell what the cluster really is.
- Unapplied edits are not dropped silently. Closing the drawer (**Close**, <kbd>Esc</kbd>, or a click on the page behind it) or changing tab while the YAML is modified asks **Discard changes?**. **Keep editing** leaves everything as it is; **Discard** drops the edit.
- **Open in bottom dock** (above the editor) moves the edit to a YAML tab in the [terminal dock](/docs/terminal/#yaml-tabs-in-the-dock), so you can keep the shell open beside it. The drawer editor stays the default. The same editor opens from **Edit in dock** in a list row's menu and from <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> (**Edit YAML in dock: \<name\>**). In the dock, <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd> applies, the tab shows a dot while modified, and it warns if the object changes on the cluster while it sits open. While the object is open in the dock, the drawer shows **Editing in dock** with **Go to tab** instead of a second editor. If the drawer has unapplied edits, it asks **Discard changes?** first.
- A **Secret** opens with its values hidden. **Reveal values** loads them, and the Audit Log records that.
- If someone else changed a field you edited since you opened the editor, Kubebay doesn't apply. It lists those fields so you can **Reload current version** and make your edit again.

Kubebay warns you before an edit that won't last:

- **Managed by Helm release …**: the edit applies, but the release's next `helm upgrade` or rollback puts the chart's values back.
- **Argo CD (…) manages this resource** or **Flux (…) manages this resource**: it'll probably be reverted on the next sync. Edit the Git source instead.
