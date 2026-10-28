---
title: Karpenter
description: Your Karpenter NodePools, what runs on each, spot against on-demand, pods that can't be placed, and safe edits that warn before they evict.
section: Integrations
order: 5
appRoutes: ["/karpenter"]
---

**Karpenter** in the sidebar's Tools reads the cluster's Karpenter `NodePool` objects. If Karpenter isn't installed, the page says so.

## NodePools

A card for each NodePool:

- how many nodes it has provisioned, and how many pods and namespaces run on them;
- its spot and on-demand mix;
- the CPU and memory it uses against its own `spec.limits`, or **no limit**.

## Unschedulable pods

Pods the scheduler can't place, with the scheduler's own message quoted as it wrote it, such as *0/5 nodes are available: 2 Insufficient cpu*. That's where the blocking constraint is named, and often why Karpenter is (or isn't) provisioning.

## Editing a NodePool

**Edit** on a card opens the NodePool's YAML in place. Above it, a banner says what the NodePool backs right now, such as *Backs 4 nodes / 61 pods / 9 namespaces · 12 pods covered by a PodDisruptionBudget · 3 spot nodes*.

Some edits make Karpenter evict pods. Kubebay flags these four:

- `spec.limits.cpu` shrinking;
- `spec.limits.memory` shrinking;
- a disruption budget's `nodes` limit being lowered;
- `consolidationPolicy` switching to `WhenEmptyOrUnderutilized`, so Karpenter may evict pods from nodes that are underutilized, not just empty.

When your edit makes one of these changes, Kubebay lists it under **This change looks risky**, and **Apply** stays disabled until you type the NodePool's name. **Dry-run** always works, because it changes nothing.

## Related

- On [Nodes](/docs/nodes/), the **NodePool** and **Capacity type** columns show which pool and capacity type each node came from.
- [Cost / Waste](/docs/cost-waste/) shows which nodes could be consolidated, and the risk spot reclaims pose.
