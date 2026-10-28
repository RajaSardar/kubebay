---
title: CRDs and custom resources
description: Every CustomResourceDefinition on the cluster, and a table for each custom resource kind.
section: Clusters and resources
order: 7
appRoutes: ["/crds"]
---

**CRDs** in the sidebar's Tools lists every CustomResourceDefinition on the cluster, grouped by API group. **Search kinds…** narrows the list. A badge says how many printer columns a kind declares. Hover over it to see their names.

Click a kind to open its table. It works like any [resource table](/docs/resources/): live rows, filter, sort, row actions, a drawer with YAML and events. Its columns are the ones the CRD declares as printer columns, so a cert-manager `Certificate` shows Ready and Secret, as `kubectl get` would.

The same kinds are also in the sidebar under **Custom Resources**, grouped by API group. A long group shows its first kinds and a **Show all** with the count.

Some operators get pages of their own, which read their custom resources for you: [Argo CD](/docs/argocd/), [Flux](/docs/flux/), [Karpenter](/docs/karpenter/), [KEDA](/docs/keda/), and Trivy-Operator's reports on [Pods](/docs/pods/#vulnerabilities-and-signatures).
