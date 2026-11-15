---
title: Create Resource
description: Create any resource from a template or your own YAML, dry-run it first, and see admission policy rejections in plain terms.
section: Clusters and resources
order: 8
appRoutes: ["/create-resource"]
---

**Create Resource** in the sidebar's Tools opens an editor with a template for the kind you pick. The **+** next to a resource table's title opens it on that table's kind.

Templates: Deployment, StatefulSet, DaemonSet, Job, CronJob, Service, Ingress, ConfigMap, Secret, PersistentVolumeClaim, ServiceAccount, Namespace, Role, ClusterRole, RoleBinding, ClusterRoleBinding, HorizontalPodAutoscaler, Pod, ReplicaSet, ReplicationController, PersistentVolume, NetworkPolicy, PriorityClass and RuntimeClass.

Edit the YAML, or paste your own. Several documents separated by `---` are applied together, and Kubebay says how many were applied.

- Tick **Dry run** to have the API server validate the YAML without saving anything. It runs defaults, validation and admission webhooks.
- **Apply** creates the resources on the active cluster.

If an admission policy rejects the change, such as Kyverno, Gatekeeper or a ValidatingAdmissionPolicy, Kubebay shows a card that names the policy engine and the webhook, with the policy's own message, rather than a raw error. Every other change in Kubebay (the YAML editor, scaling, deleting) shows the same card.

To write a NetworkPolicy without YAML, use the [policy builder](/docs/network-policy/#build-policy).
