---
title: Upgrade Readiness
description: Removed API versions, drain blockers, version skew and risky admission webhooks to check before a Kubernetes upgrade.
section: Insights
order: 5
appRoutes: ["/upgrade-readiness"]
---

**Upgrade Readiness** in the sidebar's Tools checks which deprecated API versions your cluster still serves, and when Kubernetes removes them. Before you upgrade, anything that still uses those versions, such as manifests, Helm charts or controllers, has to move to the replacement.

It lists removals coming in the next two minor releases, and any your cluster's version is already past. Each finding names the kind and API version, the Kubernetes minor release that removes it, and the version to use instead. A badge says how far away the removal is, such as **2 minors away**, or **Overdue** when your cluster's version is already past it.

It covers the removals most likely to matter, from the official [deprecation guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/): for example Ingress, CustomResourceDefinition and webhook configurations at 1.22, and PodDisruptionBudget, CronJob, HorizontalPodAutoscaler and EndpointSlice betas at 1.25. It isn't exhaustive.

It reads the API server's discovery data, which says whether a version is still served. It doesn't look at each object.

## Upgrade impact

Below the API versions, **Upgrade impact** looks at what would stall or break the upgrade itself. It reads the pods, PodDisruptionBudgets, nodes, webhook configurations and endpoints Kubebay already streams, with your own permissions. A check you can't read says so instead of showing as clear. Nothing is changed, and each finding links to the object it is about.

- **Drain blockers.** A PodDisruptionBudget that allows 0 disruptions while it protects running pods stops `kubectl drain` from finishing. Each finding lists the nodes it blocks, the workloads it protects and a suggested fix. It uses the budget's own `disruptionsAllowed`; when a budget has no status yet it works the figure out from `minAvailable` or `maxUnavailable`, whole numbers or percentages. A budget over a single running pod is shown as **Single replica**, because that pod can never be evicted.
- **Version skew.** Compares each node's kubelet and kube-proxy with the API server, following the [version skew policy](https://kubernetes.io/releases/version-skew-policy/): neither may be newer than the API server, and either may be up to three minor versions older. It also notes when nodes run different minor versions. Type a **Target Kubernetes version** such as `v1.33.0` to check the nodes against the release you plan to move to; findings that only appear after the upgrade are badged **After upgrade**. A node that reports no kube-proxy version is skipped for that component.
- **Admission webhooks.** For webhooks whose failure policy is `Fail` (the default when none is set) it flags a service with no ready endpoints, a namespace selector that doesn't exclude `kube-system`, and one that doesn't exclude the webhook's own namespace, since a drain can then deadlock. Any webhook with a timeout of 15 seconds or more is flagged too. Webhooks that call a URL rather than a service have their endpoints left unchecked.

These checks are estimates from object specs. They were tested against fixture data, not a live cluster, and they don't read each webhook's rules, so a webhook that only matches rarely used resources may still be flagged.

Upgrade readiness is part of the [findings report](/docs/rbac/#export-report).
