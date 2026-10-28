---
title: Resource details
description: A resource's drawer and full page. Its summary and owners, rollout and timeline, autoscaling, policy findings, events, the YAML editor and its actions.
section: Clusters and resources
order: 4
appRoutes: ["/detail/:kind/:ns/:name"]
---

Click a row in any [resource table](/docs/resources/) to open its drawer. A drawer closes with <kbd>Esc</kbd>, the **×**, or a click anywhere outside it.

- **Open full page** (<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Enter</kbd>) shows the resource on a page of its own, with a link you can share.
- **Split view** (<kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd>) shows two tabs side by side, such as Events beside YAML. Drag the divider to resize them. Kubebay remembers the split for each kind.

## Tabs

Every resource has **Summary**, **YAML** and **Events**. Workloads get more.

| Tab | For | Shows |
|---|---|---|
| Summary | all | Created, labels, annotations, conditions, and **Owned by**: every owner up the chain, each a link |
| Rollout | Deployments, StatefulSets, DaemonSets | Ready replicas per revision, new against old, so a stuck rollout shows which ReplicaSet it's stuck on |
| Timeline | Deployments, StatefulSets, DaemonSets | Events, rollout revisions, condition changes and container terminations on one timeline |
| Autoscaling | Deployments, StatefulSets | Every HPA, VPA and KEDA ScaledObject that targets it, with min, max and current. **New ScaledObject** creates one. See [KEDA](/docs/keda/) |
| Policy | all but policy reports | Kyverno or other PolicyReport findings for this object. Passing checks are counted, not listed |
| Vulnerabilities | Deployments, StatefulSets, DaemonSets | CVEs in its images, from Trivy-Operator |
| Signatures | Deployments, StatefulSets, DaemonSets | Whether its images are signed, checked on request |
| YAML | all | The live object, editable |
| Events | all | Its recent events |

Services have **Summary** (ports, selector, traffic) and **YAML**. Nodes have their own tabs: see [Nodes](/docs/nodes/). Pods have their own drawer: see [Pods](/docs/pods/).

## Actions

Above the tabs:

- **Deployments and StatefulSets**: set the replicas with **−** and **+**, then **Apply scale**. **Restart** rolls the pods.
- **DaemonSets**: **Restart**.
- **CronJobs**: **Trigger now** runs a Job from it at once. **Suspend** and **Resume** stop and restart its schedule.
- **Nodes**: **Cordon**, **Uncordon** and **Drain**. See [Nodes](/docs/nodes/).
- **Delete**, with a confirmation.

Changes are recorded in the [Audit Log](/docs/audit-log/).

## YAML

The YAML tab is an editor for the live object.

- **Dry-run** sends your change to the API server without saving it. **diff view** then compares the live object with what the server would store, including defaults and webhook changes. Without a dry-run, it compares your edits with the original.
- **Apply** sends only the fields you changed, as a patch, not the whole object.
- **Revert** throws your edits away. **Reload** fetches the latest version from the cluster.
- If someone else changed a field you edited since you opened the editor, Kubebay doesn't apply. It lists those fields so you can **Reload current version** and make your edit again.

Kubebay warns you before an edit that won't last:

- **Managed by Helm release …**: the edit applies, but the release's next `helm upgrade` or rollback puts the chart's values back.
- **Argo CD (…) manages this resource** or **Flux (…) manages this resource**: it'll probably be reverted on the next sync. Edit the Git source instead.
