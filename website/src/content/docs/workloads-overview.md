---
title: Overview
description: The cluster at a glance. What's broken and why, what's rolling out, how full the nodes are, single points of failure, and whether Services and DNS work.
section: Clusters and resources
order: 1
appRoutes: ["/workloads-overview"]
---

**Overview** is the first page Kubebay opens for a cluster, and the first item in the sidebar. It has four tabs: **Overview**, **Pressure**, **SPOF Radar** and **Service Health**.

## Overview

The tab reads from the top down, worst news first.

- **Cluster health** is a single line you can read aloud or paste into a chat: a verdict, how many workloads are broken out of how many, the worst one by name, and whether warnings are rising. If you've picked namespaces in the namespace filter, it judges those first and says how much is wrong outside them. **All namespaces** widens it.
- **Needs attention** lists every broken workload, worst first. Each row has:
  - the problem in plain words, with the Kubernetes term beside it, such as *Keeps crashing on start (CrashLoopBackOff)* or *Runs out of memory (OOMKilled)*;
  - ready of desired replicas, and when it started;
  - the last line its worst pod logged.

  **Show pods** opens the workload's pods. **Show logs** opens that pod's logs. When nothing is broken, it says **Nothing needs attention**.
- **Rollouts in progress** appears only while something is rolling out. It shows updated of desired for each one.
- **Unschedulable pods** quotes the scheduler's own message for each pod it can't place, such as *0/3 nodes are available: insufficient cpu*.
- **Capacity** says how much of the cluster's CPU and memory the pods request, with a bar per resource. With metrics-server installed it also shows what's actually used.
- **Namespaces** ranks namespaces by **Problems** (broken pods, then warnings) or by **Requests** (CPU requested). Click a name to see its pods.

## Pressure

A grid of namespaces against nodes. Each cell is how much of that node the namespace's pods take: their requests, or their usage once metrics-server has a sample. It's a quick way to see which team's pods crowd which node.

## SPOF Radar

Single points of failure that a node drain, an upgrade or one node going down would turn into an outage:

- **A single replica with no PodDisruptionBudget.** A Deployment or StatefulSet that runs one replica, with no PDB covering its pods. Any drain can take it down.
- **Replicas all on one node.** A workload with several replicas, no topology spread and no anti-affinity, whose pods are all on the same node. One node failure takes every replica.
- **One Ready backend.** A Service whose endpoints have exactly one Ready pod right now, so all traffic goes through it.

Filter by kind with the buttons above the list. Each finding links to its workload or Service.

## Service Health

- **Services that route nowhere.** A Service whose selector matches no pods in its namespace, usually a label typo, or whose endpoints are all not Ready. Services without a selector, and `ExternalName` Services, are skipped.
- **Ingress & Gateway routing.** Each Ingress rule, and each Gateway API HTTPRoute, is followed through Service, port and ready endpoints. Kubebay names the first hop that breaks. It also flags an Ingress with a missing IngressClass, or a TLS Secret that isn't there.
- **Cluster DNS.** Checks CoreDNS or kube-dns in `kube-system`: too few replicas, replicas not ready, replicas packed onto one node, and a Corefile missing plugins the upstream default ships with.

## What it needs

The Overview reads the whole cluster. If your identity can't list namespaces, Kubebay opens [Pods](/docs/pods/) in the namespaces you named instead. Kinds that RBAC hides from you are named on the page rather than shown as empty.
