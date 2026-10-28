---
title: Pods
description: The live pod list, and a pod's drawer for its logs, terminal, graphs, resizing, events and YAML.
section: Clusters and resources
order: 2
appRoutes: ["/workloads"]
---

**Pods** (under **Workloads** in the sidebar) lists every pod in the namespaces you've picked, as it changes.

## The list

Columns: Name, Namespace, Ready, Status, Restarts, Node, CPU, Memory and Age. CPU and memory show a bar against the pod's limit, or its request when it has no limit. [Filter and sort](/docs/interface/#filtering-a-table) as on any table. For example, `status:crash` finds crashing pods, and `node:worker-2` finds the pods on one node.

The **⋮** at the end of a row has **View details**, **Logs**, **Shell**, **Edit YAML**, **Copy name** and **Delete**.

**Show pods** in the row menu of a Deployment, StatefulSet, DaemonSet, ReplicaSet or Job lists just that workload's pods. A bar above the table names the selector. **Show all pods** goes back to the full list.

## A pod's drawer

Click a pod to open its drawer. It always opens on **Summary**, unless you chose a tab from the row menu.

### Summary

The pod's metadata, conditions, each container (image, state, ports, environment), resource claims and volumes.

- **Owned by** shows the whole chain of owners, each one a link. For example: Helm release → Deployment → ReplicaSet → pod.
- An environment variable from a Secret stays hidden until you click to reveal it.
- Click a container's port to forward it to your machine. See [Port forwarding](/docs/port-forwarding/).

### Logs

Logs stream as the container writes them.

- **Container** picks which container to show.
- **tail** sets how many earlier lines to load.
- **follow** keeps the newest line in view.
- **previous** shows the run before the last restart, which is where a crash's cause usually is.
- **Filter lines…** narrows what's shown, and **Download** saves the lines as a `.log` file.

### Terminal

A shell in the container: pick the container and the shell (**auto**, `bash`, `sh` or `ash`). **auto** tries `bash`, then `sh`, then `ash`. The session ends when you close the drawer.

### Graphs

CPU and memory per container over the last **15m** or **24h**, from Prometheus. Until a Prometheus URL is set, the tab says so and links to [Settings](/docs/settings/#prometheus). If Prometheus runs in the cluster, Kubebay gives you the `kubectl port-forward` command to reach it.

### Size

Change a container's CPU and memory requests and limits. On Kubernetes 1.33 and later this resizes the running pod in place. Only the fields you fill in are changed, and each container's resize policy decides whether it restarts. **Use suggested** fills in a [right-sizing](/docs/right-sizing/) suggestion when there is one. **Copy as patch** gives you the change for `kubectl patch`.

### Vulnerabilities and Signatures

- **Vulnerabilities** counts the CVEs Trivy-Operator found in the pod's images. It needs Trivy-Operator in the cluster.
- **Signatures** checks whether the pod's images are signed. The check contacts each image's registry, so it runs only when you ask. Choose anonymous access, or the pod's own pull secrets.

### Triage

Asks an AI model what's wrong with the pod. It sends the pod's evidence: status, events and recent logs. The tab appears only once you've turned triage on for this cluster. See [AI triage](/docs/ai-triage/).

### Events and YAML

**Events** lists the pod's recent events. **YAML** is the live object. You can edit it, dry-run the change, and apply it. See [Resource details](/docs/resource-details/#yaml).

## Deleting a pod

**Delete** asks you to type the pod's name. A pod that's finished, or never scheduled, is deleted at once. If a finalizer holds it, such as a Job's tracking finalizer, Kubebay offers to **force** the delete and says exactly what that does: skip the grace period, remove finalizers, or both.
