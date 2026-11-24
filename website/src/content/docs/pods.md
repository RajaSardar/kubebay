---
title: Pods
description: The live pod list, and a pod's drawer for its logs, terminal, graphs, resizing, events and YAML.
section: Clusters and resources
order: 2
appRoutes: ["/workloads"]
---

**Pods** (under **Workloads** in the sidebar) lists every pod in the namespaces you've picked, as it changes.

## The list

Columns: Name, Namespace, Ready, Status, Owner, Restarts, Node, IP, CPU, Memory and Age, and **Labels** (hidden until you tick it in **Columns**; the first three labels as chips, the rest as +N, all of them in the tooltip). `label:app=web` filters on a pod's labels whether or not the column is shown, and `labels:tier=front` matches the column's text. **Owner** is the pod's controller from its `ownerReferences`, as `Kind/name` linking to that object's drawer: a Deployment's pods show the Deployment (read through the ReplicaSet), others show their StatefulSet, DaemonSet, Job, a custom resource such as an Argo `Rollout`, or the Node for a static pod. A pod nothing controls shows —. Filter it with `controller:statefulset` or `controller:web`. CPU and memory show a bar against the pod's limit, or its request when it has no limit. [Filter and sort](/docs/interface/#filtering-a-table) as on any table. For example, `status:crash` finds crashing pods, and `node:worker-2` finds the pods on one node.

Status is a coloured pill, and the word always stays on it. Green is Running (or Ready), blue is Pending or still starting, purple is Succeeded or Completed, orange is a warning such as Running with containers not ready or Evicted, red is a failure such as Failed, CrashLoopBackOff or ImagePullBackOff, struck-through grey is Terminating, and plain grey is a status Kubebay doesn't recognise. Other tables use the same colours for their status words.

The **⋮** at the end of a row has **View details**, **Logs**, **Shell**, **Edit YAML**, **Copy name** and **Delete**.

**Show pods** in the row menu of a Deployment, StatefulSet, DaemonSet, ReplicaSet or Job lists just that workload's pods. A bar above the table names the selector. **Show all pods** goes back to the full list.

## A pod's drawer

Click a pod to open its drawer. It always opens on **Summary**, unless you chose a tab from the row menu.

### Summary

The pod's metadata (including its **Pod IP** and **Host IP**, or **Pod IPs** and **Host IPs** on a dual-stack cluster), **Labels**, conditions, each container (image, state, ports, every environment variable, **Environment from**), **Secrets** and **ConfigMaps**, resource claims and volumes.

- **Owned by** shows the whole chain of owners, each one a link. For example: Deployment → ReplicaSet → pod. An owner that is a custom resource, such as an Argo Rollout, opens like any other owner.
  When the pod, or a Deployment, StatefulSet or other owner above it, was installed by Helm (it carries the `app.kubernetes.io/managed-by: Helm` label), the chain ends in **Helm release <name>**. Click it to open that release's drawer on the [Helm](/docs/helm/) page. The name comes from the `meta.helm.sh/release-name` annotation, or the `app.kubernetes.io/instance` label when the annotation isn't there; the namespace comes from `meta.helm.sh/release-namespace`. It is read from labels, not from the release records, so a release that was uninstalled, or whose objects were copied from another one, can show a link that finds nothing.
- **Why this pod is not healthy.** A pod that is not healthy gets a card at the top of Summary with a short diagnosis, the field it was read from, and up to three next steps that jump to the Logs tab (on the previous container), the Events tab, the YAML tab, or the PVC or node page. It is plain rules, with no AI and no extra requests: it reads the pod's status and the events Kubebay already streams. It recognises an evicted pod, a node that is not ready, OOMKilled (with the exit code and memory limit), ImagePullBackOff, CreateContainerConfigError, CrashLoopBackOff (with the last exit code), an unbound PersistentVolumeClaim, an unschedulable pod (with the scheduler's message), a failing probe and a container that exited non-zero. Where it infers rather than reads, it says "likely". If nothing matches it says no known cause was found, and a healthy pod, or one that is just starting, shows no card.
- An environment variable from a Secret stays hidden until you click to reveal it. **Environment from** lists a container's `envFrom` sources (Secret or ConfigMap, name, prefix, optional). **Secrets** and **ConfigMaps** list every one the pod refers to, from environment variables, `envFrom`, volumes (including projected ones) and image pull secrets, each a link to its drawer with where it is used. They are references only: no Secret value is read or shown there.
- Click a container's port to forward it to your machine. See [Port forwarding](/docs/port-forwarding/).

### Logs

Logs stream as the container writes them.

- **Container** picks which container to show. It starts on the container the pod's `kubectl.kubernetes.io/default-container` annotation names, as `kubectl logs` does, and otherwise on the first container. The Terminal tab uses the same choice.
- **tail** sets how many earlier lines to load.
- **follow** keeps the newest line in view.
- **previous** shows the run before the last restart, which is where a crash's cause usually is.
- **Filter lines…** narrows what's shown, and **Download** saves the lines as a `.log` file.
- Lines are coloured by their level: errors red, warnings amber, success green, debug and trace dimmed. Kubebay reads the level from the line itself:
  - a JSON field such as `"level":"error"`, including pino's numeric levels;
  - `level=warn` in logfmt;
  - a klog prefix such as `E1112`;
  - `[error]` in brackets, or `ERROR` in capitals;
  - an exception at the start of the line, such as `Error:`, `panic:` or `Traceback`.

  A line with no level that says something failed is an error, and one that says something succeeded is a success. "error" in the middle of a sentence doesn't count. A line that carries its own colours (ANSI codes) shows them in the theme's colours rather than as escape codes. The filter matches the text you see, and **Download** keeps the lines as the container wrote them.

### Terminal

A shell in the container: pick the container and the shell (**auto**, `bash`, `sh` or `ash`). **auto** tries `bash`, then `sh`, then `ash`. The session ends when you close the drawer.

**Debug with ephemeral container** is for a container with no shell (a distroless image). It adds a debug container to the running pod, the same call as `kubectl debug`, and opens a shell in it. Pick the **Image** (it starts as the **Debug image** in [Settings](/docs/settings/#debug-image)) and the **Target container**, whose processes the debug container can see. When the cluster's name looks like production, you click twice to confirm. The new container is selected in **Container** and its shell opens at once.

- An ephemeral container can't be removed or changed. It stays in the pod's spec until the pod is replaced, but it stops when you exit its shell.
- It needs the pod to be Running and your identity to be allowed to update `pods/ephemeralcontainers` (and `pods/exec` for the shell). A refusal is shown in the dialog.
- It is recorded in the [Audit Log](/docs/audit-log/) as `debug-container`, with the container name, image and target.
- Needs Kubernetes 1.25 or newer. If the image is slow to pull, the terminal may say the container is still starting; switch tabs and back to retry.

### Graphs

CPU and memory per container over the last **15m** or **24h**, from Prometheus. If Prometheus runs in the cluster, Kubebay finds it by itself and reads it through the cluster's API server, so the graphs just work. The tab says `Auto-detected: monitoring/prometheus-server:80`, and **Change** picks another service or switches to your own URL. Only when nothing is found, and no URL is set, does the tab say so and link to [Settings](/docs/settings/#prometheus). A URL you set always wins, and if that Prometheus is unreachable Kubebay shows the `kubectl port-forward` command to reach it.

### Size

Change a container's CPU and memory requests and limits. On Kubernetes 1.33 and later this resizes the running pod in place. Only the fields you fill in are changed, and each container's resize policy decides whether it restarts. **Use suggested** fills in a [right-sizing](/docs/right-sizing/) suggestion when there is one. **Copy as patch** gives you the change for `kubectl patch`.

### Vulnerabilities and Signatures

- **Vulnerabilities** counts the CVEs Trivy-Operator found in the pod's images, and **Open on the Vulnerabilities page** shows them all. See [Vulnerabilities](/docs/vulnerabilities/).
- **Signatures** checks whether the pod's images are signed. The check contacts each image's registry, so it runs only when you ask. Choose anonymous access, or the pod's own pull secrets.

### Triage

Asks an AI model what's wrong with the pod. It sends the pod's evidence: status, events and recent logs. The tab appears only once you've turned triage on for this cluster. See [AI triage](/docs/ai-triage/).

### Events and YAML

**Events** lists the pod's recent events. **YAML** is the live object. You can edit it, dry-run the change, and apply it. See [Resource details](/docs/resource-details/#yaml).

## Deleting a pod

**Delete** asks for a plain confirmation that names the pod: click **Delete** to go ahead or **Cancel** to keep it. You don't type the name; pods are recreated by their controller, and every other kind still asks you to type its name. A pod that's finished, or never scheduled, is deleted at once. If a finalizer holds it, such as a Job's tracking finalizer, Kubebay offers to **force** the delete and says exactly what that does: skip the grace period, remove finalizers, or both.
