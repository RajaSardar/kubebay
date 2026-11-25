---
title: Resource details
description: A resource's drawer. Its summary and owners, rollout and timeline, autoscaling, policy findings, events, the YAML editor and its actions.
section: Clusters and resources
order: 4
appRoutes: ["/detail/:kind/:ns/:name"]
---

Click a row in any [resource table](/docs/resources/) to open its drawer. Every kind opens in this drawer on the right, as pods do, and a shared link to a resource opens the same drawer over its list. A drawer closes with <kbd>Esc</kbd>, the **×**, or a click anywhere outside it.

Drag the drawer's left edge to make it wider or narrower (at least 360 pixels, at most 90% of the window). The edge works from the keyboard too: <kbd>Tab</kbd> to it, then <kbd>←</kbd> widens and <kbd>→</kbd> narrows by 16 pixels (<kbd>Shift</kbd> for 64), <kbd>Home</kbd> and <kbd>End</kbd> go to the narrowest and widest, and a double-click puts it back to 820 pixels (or three quarters of a narrow window). Every kind of drawer shares the one width, which is remembered and is read when a window opens, so another window that is already open doesn't change under you. The full-page view of a resource has no edge to drag.

- **Copy name**, a large button right after the title, copies the resource's name (without its namespace) to the clipboard and shows **Copied** for a moment.
- **Split view** (<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd>) shows two tabs side by side, such as Events beside YAML. Drag the divider to resize them. Kubebay remembers the split for each kind.

## Tabs

Every resource has **Summary**, **YAML** and **Events**. Workloads get more.

| Tab | For | Shows |
|---|---|---|
| Summary | all | Created, labels, annotations, conditions, and **Owned by**: every owner up the chain, each a link. Deployments, StatefulSets, DaemonSets and Jobs end with **Pods**: every pod they own, with Name, Ready, Status, Restarts, Node and Age |
| Logs | Deployments, StatefulSets, DaemonSets, Jobs | The logs of all the workload's pods in one list, each line tagged with its pod (the generated end of its name, tinted; hover for the full name). See below |
| Rollout | Deployments, StatefulSets, DaemonSets | Ready replicas per revision, new against old, so a stuck rollout shows which ReplicaSet it's stuck on |
| Timeline | Deployments, StatefulSets, DaemonSets | Events, rollout revisions (with image and change-cause), condition changes, container terminations and the changes you made through Kubebay (its audit log) on one timeline. The **All**, **Events**, **Audit** and **Rollouts** buttons filter it, the time column shows how long ago with the exact time on hover, and each object name opens that object. The audit entries match by cluster, namespace, name and kind (older entries, which have no kind, by name only), and name who made the change when they signed in through OIDC |
| Autoscaling | Deployments, StatefulSets | Every HPA, VPA and KEDA ScaledObject that targets it, with min, max and current. **New ScaledObject** creates one. See [KEDA](/docs/keda/) |
| Policy | all but policy reports | Kyverno or other PolicyReport findings for this object. Passing checks are counted, not listed |
| Vulnerabilities | Deployments, StatefulSets, DaemonSets | How many CVEs Trivy-Operator found in its images, with a link to them on the [Vulnerabilities](/docs/vulnerabilities/) page |
| Signatures | Deployments, StatefulSets, DaemonSets | Whether its images are signed, checked on request |
| YAML | all | The live object, editable |
| Events | all | Its recent events |

Services have **Summary** (ports, selector, **Endpoints**, traffic) and **YAML**. **Endpoints** lists the addresses from the Service's EndpointSlices with Ready or Not ready, the ports they serve, the node, and the target Pod as a link to its drawer; with none it says no ready Pod matches the selector. It isn't shown for an ExternalName Service. Nodes have their own tabs: see [Nodes](/docs/nodes/). Pods have their own drawer: see [Pods](/docs/pods/).

**Logs for all pods together.** The **Logs** tab follows every pod the workload owns (through its ReplicaSets for a Deployment) and merges their lines into one list, tagged by pod. Each pod is its own log stream opened as you, so a pod your account may not read logs for is named above the list with the reason, and the rest carry on. At most 20 pods are followed, running ones first and then by name; when the workload has more, the view says **Showing 20 of N pods**. **Filter pods…** narrows which pods are followed (a part of a name, or `"name"` or `=name` for one exact pod), and a pod's button under the count sets that filter to that pod. **tail**, **follow**, **previous**, **Filter lines…** and **warnings and errors only** work as in a [pod's Logs](/docs/pods/#logs), and the count of hidden lines is shown too. Streams open a few at a time. Lines are kept in the order they arrive, not sorted by time, so at the start the lines of one pod come in a block before the next pod's; the list keeps the newest 5000 lines. Each pod shows its first container (a pod with several shows only that one). Not run against a live cluster.

**Pods** at the bottom of a workload's Summary lists the pods it owns through its controllers: a Deployment's through its ReplicaSets (old and new during a rollout), a StatefulSet's, DaemonSet's or Job's directly. Click a row to open that pod's drawer. It updates live, so a restarting or replaced pod changes in place. It shows the first 50 pods and a **Show all N pods** button for the rest, and says so when the workload has none.

## Actions

Above the tabs:

- **Deployments and StatefulSets**: the drawer row has one **Scale: 3** button. It opens a panel with a number box (type an exact count; the way to a very large one), a slider, one-click counts (**0 (stop)**, 1, 2, 3, 5, 10, **Half**, **2×** and **Current**, without duplicates) and a line such as `3 → 8 (+5)`. The slider is finest from 0 to 10 and coarser above, and its top is about three times the current count; a count you type past it keeps the thumb at the end and is not changed until you drag it. On the slider the arrow keys move one replica (<kbd>Shift</kbd> ten), <kbd>Home</kbd> and <kbd>End</kbd> jump to the ends; <kbd>Shift</kbd>+<kbd>↑</kbd>/<kbd>↓</kbd> in the number box moves by 10. The count never goes below 0. Nothing is sent until you press **Apply scale**. While the count differs from the current one the button reads **Scale: 3 → 8**, the panel shows an **Unsaved** badge and **Reset to 3**, and **Apply scale** turns solid; set it back and all of them go. <kbd>Esc</kbd> or a click elsewhere closes the panel and keeps your count; <kbd>Enter</kbd> in the number box moves focus to **Apply scale** and does not press it. The panel warns that scaling to 0 runs no pods, and for a StatefulSet that scaling down removes the highest ordinals first. The **Scale** button in a table row's menu opens a dialog with the same controls in place. **Restart** rolls the pods; it asks for a second click first (the button turns into **Confirm restart?**, and goes back if you leave it).
- **Argo Rollouts**: the same **Scale** button and **Apply scale** set a Rollout's replicas, and **Restart** replaces its pods following its strategy by setting `spec.restartAt` (the same as Restart on the Rollouts page). **Pause** sets `spec.paused`, **Resume** (shown instead of Pause when you paused it) clears it, and **Skip step** moves a canary to its next step through the status subresource, after a second click. The drawer also has **Promote**, **Promote fully**, **Abort** and **Retry**, the same as the Rollouts page and from **Custom Resources → Rollouts** too, each only when it fits the Rollout's state (Retry only after an Abort); **Promote fully**, **Abort** and **Restart** ask for a second click. See [Argo Rollouts](/docs/argo-rollouts/#actions) for what each sends. The step-by-step **Release** view (steps, canary and stable ReplicaSets, Services, AnalysisRun metrics) is on the Rollouts page, not in the drawer; see [The Release view](/docs/argo-rollouts/#the-release-view).
- **DaemonSets**: **Restart**, with the same second click.
- **Owner column**: ReplicaSets show **Owner** (the Deployment, or a custom controller such as an Argo `Rollout`, that controls them; — for a bare one). Every other list can show it from the column chooser (hidden by default; Events have none), which is how a Job shows its CronJob. It is the Kubernetes controller, not the GitOps app (that is **Managed by**). Each owner links to its drawer, and the filter takes `controller:deployment`.
- **CronJobs**: the list has a **Status** column (Suspended, Active when jobs are running, or Idle) and an **Active Jobs** count beside **Last Schedule**. **Next Schedule** shows when it will next run ("in 12m"); hover for the exact time. It reads the schedule (lists, ranges, steps, month and day names, `@daily` and the other `@` shortcuts) in the CronJob's `timeZone`, or UTC when none is set, and shows – when the CronJob is suspended or its schedule is invalid. **Trigger now** runs a Job from it at once. **Suspend** and **Resume** stop and restart its schedule.
- **Nodes**: **Cordon**, **Uncordon** and **Drain**. See [Nodes](/docs/nodes/).
- **Delete**, with a confirmation.

**Add sidecar.** Deployments, StatefulSets, DaemonSets and CronJobs have **Add sidecar**, which appends one container to the pod template (Jobs don't: a Job's pod template can't change once created). Pick a preset to fill the form, then edit anything:

- **Log shipper**: `busybox` running `tail -F` on a new shared emptyDir, `shared-logs` at `/var/log/app`, also mounted in the app containers so they can write their logs there.
- **Debug toolbox**: `nicolaka/netshoot` running `sleep infinity`, to exec into next to the app.
- **Cloud SQL proxy**: the Cloud SQL Auth Proxy on port 5432; replace `PROJECT:REGION:INSTANCE` with your instance, or change the image and args for another proxy.
- **Custom**: an empty form.

The form takes **Name**, **Image**, **Command**, **Args** and **Env** (split on spaces, quotes keep words together, env as `KEY=value`), **Ports** (`8080, 9090/UDP`), **CPU request**, **Memory request**, **CPU limit** and **Memory limit**. **Mount existing volumes** mounts any of the pod's volumes at a path you give, and **New shared emptyDir** adds an emptyDir with **Volume name** and **Mount path**, mounted in the sidecar and in each container you tick under **Also mount in**. The mount hides whatever the image had at that path. A name that's already a container or init container in the template is refused, as are a volume name that's taken and a path that's already mounted.

On Kubernetes 1.29 or newer, **Sidecar type** offers **Native sidecar** (the default) or **Regular container**. A native sidecar is an init container with `restartPolicy: Always`: it starts before the app containers, runs as long as the pod and never keeps a Job from finishing. A regular container is added to `containers` and starts alongside the app with no set order. On older clusters, or when Kubernetes doesn't report a version, the sidecar is a regular container and the dialog says why. A CronJob only takes a native sidecar, because a regular container that never exits keeps every Job running.

The dialog warns that changing the pod template triggers a rollout restart (for a CronJob, that only the Jobs it creates next get the sidecar), shows **What this affects** for the restart, and repeats the Argo CD or Flux warning when one manages the workload, since it will revert the change. **Preview** dry-runs the change on the server and shows the live YAML against the result as a diff. **Add sidecar** is enabled only once the current form has been previewed, and on a cluster whose name looks like production it asks first. It sends a strategic merge patch that names only the new container, its volume and its mounts, never the whole object, and the change is recorded in the audit log as `add-sidecar`.

**What this affects.** Before you delete a workload, Pod or Node, scale a workload down, restart it, or drain a Node, the confirmation has a collapsed **What this affects** line. In the drawer it appears under **Apply scale** as soon as the count you chose is below the current one. Open it to see, from the data Kubebay already streams: the ReplicaSets and Pods involved, Services whose only backing Pods would go (they would lose all endpoints) and the Ingresses and HTTPRoutes that reach them, HorizontalPodAutoscalers aimed at the workload, PodDisruptionBudgets that cover the Pods (flagged when they would be violated or block a drain), PersistentVolumeClaims in use (the data is kept), and Pods with no controller that nothing will recreate. Each list shows up to five names and a count of the rest.

A scale down to a count above zero (for example 5 to 2) lists the Pods that would go: a StatefulSet's highest ordinals, or for a Deployment the ones its controller picks first (unscheduled, then not ready, then the newest), so treat those names as likely rather than certain. It also lists Services left with fewer ready endpoints, shown as `web (5 → 2 ready)`, and flags a Service that would have none. A PodDisruptionBudget is flagged when the new count would leave it below a numeric `minAvailable` (a budget does not block a scale down, so nothing stops it). A HorizontalPodAutoscaler aimed at the workload is flagged because it sets the replica count itself and may undo the change, and when its `minReplicas` is above the new count the preview says it will scale back up to at least that. A StatefulSet whose `persistentVolumeClaimRetentionPolicy.whenScaled` is `Delete` has its claims flagged, since their data goes with the Pods.

Deleting several selected rows at once (**Delete N selected** in a resource table) shows one **What this affects** for the whole selection: it says how many are selected, adds up the ReplicaSets, Pods, Services, budgets and claims across all of them, counts an object they share once, and judges Services against the whole selection, so two Deployments that together back a Service show it losing all endpoints. When the selection spans namespaces the names carry their namespace, as `shop/web`. A part Kubebay cannot read, for example because RBAC forbids it, says unknown instead of guessing. On a cluster whose name looks like production a warning shows above it. It is advisory: it never blocks the action, and the API server still decides.

Changes are recorded in the [Audit Log](/docs/audit-log/).

## Compare two resources

Compare shows two objects as a side-by-side diff of their YAML, in an editor you can scroll and search. They can be of any kind and on any connected cluster, so you can set a Deployment in `dev` against the same one in `prod`. Three ways to start:

- Tick exactly two rows in a resource table. **Compare** appears in the selection bar (with any other number of rows it is not shown).
- Open an object and choose **Compare with…** in its drawer header (Pods have it too). That object is the left side. Pick the right side in the dialog: choose a **cluster** from the connected ones, then search by name, or by kind and name as in the command palette (`deploy api`).
- Open the command palette and type `compare`, then choose **Compare resources…** and pick both sides in the dialog.

**Hide noise** is on at first. It leaves out what differs between any two objects without meaning anything: `metadata.managedFields`, `resourceVersion`, `uid`, `generation`, `creationTimestamp`, `status` and the `kubectl.kubernetes.io/last-applied-configuration` annotation. Turn it off to compare the rest of the object as well (`uid`, `creationTimestamp`, `status` and the annotation); `managedFields`, `resourceVersion` and `generation` are never fetched for a comparison, so they do not show either way. Keys are sorted, so the same object always reads the same, and a multi-line value (a ConfigMap file) is shown line by line, so a one-line change is one changed line.

**Swap sides** exchanges left and right. **Copy diff** copies the difference as unified diff text (three lines of context) for a ticket or a chat; it is disabled when there is nothing to copy. When the two sides are equal the dialog says **No differences**.

**Secrets.** Secret values are never fetched for a comparison. A Secret is compared by its keys and the size of each value (`<7 bytes>`), so two Secrets with the same keys and sizes but different values look the same. Nothing is recorded as a reveal, because nothing is revealed. To see a value use the Secret's own **Show**, which is audited.

**Your access.** Each side is read from its own cluster with your own permissions, the same read the YAML tab makes. If you may not read one side the dialog says so, for example "You are not allowed to read prod: shop/api", with the API server's reason, and shows no diff; a side that has been deleted says it was not found, and an unreachable cluster says the object could not be read. The other side is still read. Compare only reads: it changes nothing and writes nothing to the Audit Log.

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
