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
- **Apply** creates the resources on the active cluster. If the cluster's name reads like production (`prod`, `prd`, `live`, `production`), it asks **Apply to production?** first. A dry run never asks. The check is of the name only.
- Once you have edited the YAML, switching the kind (which would reset it to that kind's template), following a link to another page, or closing the window asks **Discard changes?** first.

**Open in dock** (next to **Apply**) moves the editor into a **New resource** tab in the bottom dock, so you can keep it beside a list or logs. It brings the kind and any text you typed, and the page goes back to the template. The tab behaves like the page: the same kinds, **Dry run**, the production confirmation and the **Discard changes?** prompt. See [YAML tabs in the dock](/docs/terminal/#yaml-tabs-in-the-dock).

If an admission policy rejects the change, such as Kyverno, Gatekeeper or a ValidatingAdmissionPolicy, Kubebay shows a card that names the policy engine and the webhook, with the policy's own message, rather than a raw error. Every other change in Kubebay (the YAML editor, scaling, deleting) shows the same card.

To write a NetworkPolicy without YAML, use the [policy builder](/docs/network-policy/#build-policy).
