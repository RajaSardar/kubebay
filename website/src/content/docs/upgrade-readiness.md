---
title: Upgrade Readiness
description: API versions your cluster still serves that a coming Kubernetes release removes.
section: Insights
order: 5
appRoutes: ["/upgrade-readiness"]
---

**Upgrade Readiness** in the sidebar's Tools checks which deprecated API versions your cluster still serves, and when Kubernetes removes them. Before you upgrade, anything that still uses those versions, such as manifests, Helm charts or controllers, has to move to the replacement.

It lists removals coming in the next two minor releases, and any your cluster's version is already past. Each finding names the kind and API version, the Kubernetes minor release that removes it, and the version to use instead. A badge says how far away the removal is, such as **2 minors away**, or **Overdue** when your cluster's version is already past it.

It covers the removals most likely to matter, from the official [deprecation guide](https://kubernetes.io/docs/reference/using-api/deprecation-guide/): for example Ingress, CustomResourceDefinition and webhook configurations at 1.22, and PodDisruptionBudget, CronJob, HorizontalPodAutoscaler and EndpointSlice betas at 1.25. It isn't exhaustive.

It reads the API server's discovery data, which says whether a version is still served. It doesn't look at each object.

Upgrade readiness is part of the [findings report](/docs/rbac/#export-report).
