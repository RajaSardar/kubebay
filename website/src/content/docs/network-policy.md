---
title: Network policies
description: Who can talk to whom. A connectivity matrix, coverage gaps, a reachability check, a policy builder that dry-runs before it creates, and a live network test.
section: Clusters and resources
order: 6
appRoutes: ["/network-policy"]
---

**NetworkPolicies** is under **Network** in the sidebar. It reads the cluster's NetworkPolicies and its pods' labels, and works out what traffic they allow. Pick namespaces in the namespace filter, then choose a view.

## Connectivity matrix

Rows are sources and columns are destinations. Each is a group of pods with the same namespace and app label: `app`, or else `app.kubernetes.io/name`, or else `k8s-app`. A cell says whether traffic from one to the other is allowed or blocked. Click a cell to see why:

- **No NetworkPolicy selects either pod, so traffic is unrestricted.**
- **Allowed by:** the policies and rules that let it through.
- **Isolated, and no rule allows this traffic:** the policies that isolate the pods, with no rule that matches.

## Policy list

Every NetworkPolicy in the selected namespaces: its types, pod selector, and its ingress and egress rules.

## Coverage gaps

Workloads that no NetworkPolicy covers, as a flat list rather than a grid you'd have to scan. When there are none, it says **Every workload has NetworkPolicy coverage.**

## Can A reach B?

Pick a **source pod** and a **destination pod**, and optionally a port and protocol. Kubebay evaluates the policies for that exact pair and shows the egress side, the ingress side, and which rule decides each.

## Build policy

**Build a NetworkPolicy** from a form instead of writing YAML:

1. Pick the namespace, name the policy, and choose the pods it selects by label, such as `app=web`. Leave labels empty for every pod in the namespace.
2. For **Ingress** and **Egress**, pick **not restricted**, **deny all**, or **allow only…**. With **allow only…**, add peers by namespace, labels or CIDR, and ports such as `8080, 53/UDP`. For egress you can allow DNS in one click.
3. Kubebay shows the YAML, and the effect on live pods: what would be **newly isolated**, what **would be blocked**, what **would be opened**, and what's **restricted to some ports**.
4. **Dry run** sends the policy to the API server without saving it. **Create** appears only once a dry run of exactly this policy has passed.

On a large cluster, the impact preview checks the first 20,000 pod pairs and says so.

## Live network check

The matrix and the reachability check read policy. To test the real network, **Start diagnostic pod** creates a short-lived pod in a namespace you pick, with `dig`, `curl` and `traceroute`. The image is `nicolaka/netshoot:v0.13` unless you change it. It opens in a terminal, with commands to **Try**. **Stop and delete pod** removes it, and so does leaving the page.
