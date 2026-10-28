---
title: Resource tables
description: Every Kubernetes kind as a live table, with row actions, GitOps owners, bulk delete and a create button.
section: Clusters and resources
order: 3
appRoutes: ["/r/:kind"]
---

Every kind in the sidebar groups opens the same kind of table: Deployments, ConfigMaps, Services, PVCs, Nodes, and so on. So do the custom resource kinds under **Custom Resources**. A table streams from the cluster, so rows appear, change and disappear as the cluster does. A row whose shown values change is tinted for a moment.

## The sidebar groups

| Group | Kinds |
|---|---|
| Workloads | Overview, Pods, Deployments, ReplicaSets, StatefulSets, DaemonSets, Jobs, CronJobs, ReplicationControllers, ControllerRevisions |
| Configuration | ConfigMaps, Secrets, ResourceQuotas, LimitRanges, HPAs, PDBs, PriorityClasses |
| Network | Services, Endpoints, EndpointSlices, Ingresses, IngressClasses, [NetworkPolicies](/docs/network-policy/) |
| Storage | PVCs, PVs, StorageClasses, VolumeAttachments, CSI Drivers, CSI Nodes, CSI Capacities |
| Devices (DRA) | ResourceClaims, ResourceClaimTemplates, DeviceClasses, ResourceSlices: GPUs and other devices, through Dynamic Resource Allocation |
| Access Control | ServiceAccounts, Roles, ClusterRoles, RoleBindings, ClusterRoleBindings |
| Admission | Mutating and Validating Webhooks, Admission Policies and Policy Bindings, Policy Reports, Vulnerability Reports |
| Cluster | [Nodes](/docs/nodes/), Namespaces, Events, RuntimeClasses, Leases, CertSigningRequests, API Services, FlowSchemas, Priority Levels |

## Columns

Each kind shows the columns that matter for it, such as Ready and Up-to-date for Deployments, or Type and Cluster IP for Services. Custom resources add the printer columns their CRD declares. The **Columns** button shows, hides and reorders them.

**Managed by** names the Argo CD Application or Flux Kustomization or HelmRelease that deploys the object, and links to it on the [Argo CD](/docs/argocd/) or [Flux](/docs/flux/) page.

## Row actions

The **⋮** at the end of a row has:

- **View details** opens the [drawer](/docs/resource-details/), and **Edit YAML** opens it on the YAML tab.
- **Show pods** lists the pods of a Deployment, StatefulSet, DaemonSet, ReplicaSet or Job. See [Pods](/docs/pods/).
- **Scale…** sets a Deployment's or StatefulSet's replicas with **−** and **+**.
- **Restart…** restarts a Deployment, StatefulSet or DaemonSet. Its pods are replaced one by one, following its rollout strategy.
- **Copy name**.
- **Delete** asks you to confirm. If Argo CD or Flux manages the object, Kubebay warns that it'll probably come back on the next sync.

## Deleting several at once

Tick rows, or press <kbd>x</kbd> on them, then click **Delete** in the bar above the table. The confirmation names what you're about to delete, such as *api, etl, run-0 +4 more, across 3 namespaces*.

## Creating one

The **+** next to the table's title opens [Create Resource](/docs/create-resource/) with a template for that kind.

## When RBAC says no

If your identity can't list a kind, the table shows the API server's own message instead of a list that would never load. If it can list some of the namespaces you picked and not others, the table names the ones it can't read.
