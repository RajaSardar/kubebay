---
title: Best practices
description: A checklist of reliability, security and recovery practices for the connected cluster, and what to install for the ones it lacks.
section: Insights
order: 6
appRoutes: ["/best-practices"]
---

**Best practices** in the sidebar's Tools checks the connected cluster against 24 common practices, and says what to install for the ones it lacks. The header counts how many pass.

Each item is **Pass**, **Fail**, **Unknown** or, if you chose, **Ignored**, with a line on why it matters. **Unknown** means Kubebay couldn't read what the check needs, for example because your RBAC doesn't let you list it. It is never shown as a pass.

## Severity, score and filters

Every check has a severity: **Critical**, **High**, **Medium** or **Low**. A strip at the top shows the percentage of checks that pass, the **Pass**, **Fail** and **Unknown** counts, and how many failing checks there are at each severity. Unknown checks count against the percentage, never for it.

Three selects narrow the list: **Severity**, **Status** (Fail, Unknown, Ignored or Pass) and **Sort by** (theme, severity or status). Each check also has a **Learn** disclosure with a short plain-language lesson and the official documentation address as text.

## What it checks

**Reliability**
- **PodDisruptionBudgets on multi-replica workloads.** A Deployment or StatefulSet with more than one replica needs a budget whose selector matches its pods, or a node drain can evict every replica at once.
- **Resource requests and memory limits.** Every container sets CPU and memory requests and a memory limit. [Right-sizing](/docs/right-sizing/) helps pick the numbers.
- **Readiness probes.** Every container has one.
- **Liveness probes.** Every container has one.
- **Images use a pinned tag.** No image on `:latest` or with no tag; a digest is fine.
- **All nodes Ready.** Lists any node that is not.
- **Autoscalers have headroom.** No HorizontalPodAutoscaler is already at its maximum replicas.

**Security**
- **NetworkPolicies** in each namespace that has workloads. See [Network policy](/docs/network-policy/).
- **Pod Security Admission labels.** Each namespace has a `pod-security.kubernetes.io/enforce` label.
- **A policy engine**, Kyverno or Gatekeeper.
- **An image scanner**, Trivy-Operator. When it is installed, the item links to [Vulnerabilities](/docs/vulnerabilities/).
- **No privileged containers.**
- **No hostNetwork, hostPID or hostPath** on a workload.
- **Containers don't run as root.** Flags a workload that sets `runAsUser: 0` or `runAsNonRoot: false`.
- **Default ServiceAccount token not mounted.** Flags a workload on the default ServiceAccount that doesn't set `automountServiceAccountToken: false`.
- **No plain-text secrets in env vars.** Flags an env var named like a password, token, secret or key that holds a literal value instead of a `secretKeyRef`.
- **LoadBalancer Services limit source ranges.** Flags a LoadBalancer Service with no `loadBalancerSourceRanges`.

**Disaster recovery**
- **A backup tool**, Velero.
- **Volumes have a backup schedule.** With PersistentVolumeClaims in the cluster, at least one Velero Schedule must exist. A managed snapshot policy can't be seen, so a failure here says "detected", not "unprotected".

**Platform**
- **metrics-server**, which autoscaling, `kubectl top` and Kubebay's usage columns read from.
- **An ingress controller**, found by an IngressClass.
- **cert-manager**, for certificate renewal.
- **Certificates not near expiry.** Flags a cert-manager Certificate that isn't Ready or expires within 14 days. With cert-manager absent it passes with "No cert-manager Certificates found".
- **Nodes run one Kubernetes minor version.** Flags nodes whose kubelet minor versions differ.

The workload checks show a count and up to three examples. The `kube-system`, `kube-public` and `kube-node-lease` namespaces are left out.

## What the workload checks cover

The workload checks (requests and limits, probes, privileged, root, host access, latest tag, ServiceAccount token, env secrets) read the pod template of every Deployment, StatefulSet, DaemonSet and CronJob, and every bare Pod, meaning a Pod no controller owns. A line under the strip lists what was covered, for example "Deployments 12, StatefulSets 2, DaemonSets 3, CronJobs 1, bare Pods 4". A kind Kubebay couldn't read shows "not read", and nothing of it was checked. Pods owned by a controller are checked through their controller, not twice.

## Ignoring a check

A check that is fine for your cluster can be left out. On a failing or Unknown check, **Ignore this check** asks for a reason (required), then marks the check **Ignored**. On a failing check that lists namespaces, **Ignore for namespace X** drops only that namespace's findings; the check turns Ignored once none are left.

An Ignored check is never counted as a pass and is left out of the percentage; the strip shows **Ignored N** and the header counts only the checks still scored. Each exception shows its reason and an **Undo ignore** button. Exceptions are saved in this browser, per cluster, and are not shared with a teammate or another machine.

## CIS reference tags

A few checks carry a small tag such as **CIS 5.2.2**: the section of the CIS Kubernetes Benchmark that covers the same practice. Only checks with a plain match are tagged (privileged containers, root containers, NetworkPolicies per namespace, ServiceAccount token mounting); the rest have none. The tag is a reference to read further, not a compliance score, and section numbers follow benchmark v1.8, so confirm them against your version.

## Exporting

**Export report** in the header saves the checklist as **JSON** or **Markdown**: every check with its status, severity and reference, the workload coverage, and each ignore with its reason. It is built in your browser and sent nowhere.

## Installing what's missing

A tool is detected by the API groups the cluster serves, such as `velero.io`. When it isn't, its item has a **How to install** disclosure with the tool's own install command and a link to its official guide. The command is text only: Kubebay never runs it, so copy it to your terminal, or use the [Helm](/docs/helm/) page. When the tool is installed, the item links to the Kubebay page that works with it.

"Not detected" doesn't mean unprotected. A managed add-on, a cloud load balancer or a Gateway API controller can cover the same need, and Kubebay can't see those.

## What it reads

Deployments, StatefulSets, DaemonSets, CronJobs, Pods, PodDisruptionBudgets, NetworkPolicies, Namespaces, IngressClasses, Services, PersistentVolumeClaims, Nodes, HorizontalPodAutoscalers, cert-manager Certificates and Velero Schedules (the last two only when the cluster has them) and the cluster's API list, with your own credentials. It changes nothing in the cluster.
