---
title: Right-sizing
description: CPU and memory requests that are far from what workloads use, ranked by waste, with a dry-run preview and one-click apply.
section: Insights
order: 2
appRoutes: ["/right-sizing"]
---

**Right-sizing** in the sidebar's Tools ranks Deployments, StatefulSets and DaemonSets whose CPU or memory requests are far from what they use, by how much they waste across all their replicas.

## Where the numbers come from

Each row says which recommender it came from, so you know how much to trust it:

- **VPA**: a VerticalPodAutoscaler recommendation. This is a purpose-built controller, and it wins when it covers a workload.
- **Kubebay (Prometheus, 7d)**: Kubebay's own p95 of the last 7 days, from your cluster's Prometheus.
- **Kubebay (metrics-server)**: Kubebay's own p95 of the last 3 hours, from metrics-server samples. It's the least certain, and is shown as such.

A difference counts only when it's at least 20% and at least 50m of CPU or 64Mi of memory, so a tiny container doesn't outrank real waste.

## The list

Each row shows the workload, container and replicas, the current request, the target, and the fleet-wide waste. Tick **cpu** and **memory** to choose what to change. Kubebay ticks what's worth changing, except CPU on a workload whose HPA scales on CPU (**HPA scales this on CPU**): changing its CPU request would change how it scales.

- **Preview dry-run** shows the change as the API server would store it.
- **Copy patch** gives you the patch to apply yourself, or to put in Git.
- **Apply** patches the workloads after you confirm, such as *Apply to 12 pods across 3 container(s)?* Their pods roll as they would for any spec change.

Rows from Kubebay's own recommender are view-only. They're per workload, not per container, so there's no patch to build from them. Create a VPA for those to get container-level recommendations.

If Argo CD or Flux manages a workload, Kubebay warns that the change will be reverted on the next sync. Change it in Git instead.

## Setting up VPA

If no VPA recommender is installed, **Install VPA recommender** installs just the recommender with Helm. The updater and admission controller stay off, so nothing evicts or resizes a running pod, and no admission webhook is installed. Kubebay shows what it will create before it does. It also says that upstream marks the chart as not yet recommended for production.

The recommender only computes recommendations for workloads that have a VerticalPodAutoscaler object. **Create VPA (Off)** creates one with `updateMode: Off`, so it recommends and never acts.

## In a workload's drawer

When a workload has a right-sizing opportunity, its drawer shows it with **View in Right-sizing →**. A pod's [Size tab](/docs/pods/#size) can fill in the suggestion with **Use suggested**.
