---
title: Cost / Waste
description: Where the cluster's capacity goes, with an efficiency score, usage against requests, GPU use, nodes you could consolidate, spot risk, headroom forecasts and unusual usage.
section: Insights
order: 4
appRoutes: ["/cost-waste"]
---

**Cost / Waste** in the sidebar's Tools accounts for the cluster's capacity: what's requested, what's used, and what's idle. It works in CPU and memory, not money, because Kubebay doesn't know what you pay.

## Efficiency score

One score, **Good**, **Fair** or **Poor**, from three parts:

- **Provisioning** (half the weight): how much of allocatable CPU and memory is requested. 80% or more earns full marks; the rest is burst headroom.
- **Request coverage**: how many containers set resource requests.
- **Workload sizing**: how many workloads are sized close to their p95 usage. It needs metrics-server or Prometheus. Without usage data it's left out and says so, rather than guessed.

## Capacity

- **Idle capacity (cluster-wide)**: allocatable minus requests. It's never charged to a namespace.
- **System overhead (DaemonSets)**: what DaemonSets request, on its own line.
- **Requested by namespace**, down to each pod and container.
- **By node**: allocatable, requested, system overhead and idle for each node.

## Workload usage vs requests

Each workload's request, its observed p95 usage, how much is wasted, and the window it was measured over. It uses the same recommender as [Right-sizing](/docs/right-sizing/), but read-only. To change requests, use Right-sizing.

## GPUs

Shown only on clusters with GPU nodes.

- **GPU capacity**: GPUs claimed against allocatable, per node.
- **GPU utilisation**: how busy each pod's NVIDIA GPUs are, average and peak, and peak memory, from the DCGM exporter through your cluster's Prometheus. A pod is marked **underused**, **in use**, **too little data** or **no DCGM data**.

## Node consolidation

For each node: would its pods fit on the other nodes, by requests? The simulation honours nodeSelectors, required node affinity and `NoSchedule` and `NoExecute` taints. Each node gets a verdict:

- **fits elsewhere**: it could be drained;
- **drain causes downtime**: it runs a single-replica workload with no PodDisruptionBudget (see [SPOF Radar](/docs/workloads-overview/#spof-radar));
- **blocked**: something stops a clean drain. A pod fits nowhere else, isn't owned by a controller (so nothing would recreate it), has required pod affinity or anti-affinity or a host port (which the simulation doesn't model), or a PodDisruptionBudget allows no disruption right now;
- **skipped**: the node isn't a candidate: it's not Ready, already cordoned, or a control-plane node.

The **Why** column names each blocker.

It's read-only. Kubebay never cordons or drains a node from here.

## Spot disruption risk

Workloads whose every running replica is on spot or preemptible nodes, so one reclaim wave can take them all:

- a single replica, which a PDB can't protect, because reclaims don't go through the Eviction API;
- several replicas with no PDB, so drains ahead of a reclaim aren't coordinated.

## History, forecasts and anomalies

These read Kubebay's local [usage history](/docs/settings/#usage-history). A chip says how much history the cluster has, such as *observed 09–18 local, weekdays only*.

- **Headroom forecast**: the trend of the cluster's daily peak against allocatable, and when it would run out. It needs at least 5 days, each with at least 4 well-sampled hours, and says how many more it needs until then. Missing hours are never filled in.
- **Unusual usage**: hours in the last day that stand out from the same hour on earlier days of the same kind (weekday or weekend). It needs at least 5 such days.

Because history is recorded only while Kubebay is open, the forecast is of the daily peak during the hours you had it open.
