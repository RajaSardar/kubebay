---
title: Nodes
description: A node's capacity, conditions and taints, a root shell on the node, and cordon, uncordon and drain.
section: Clusters and resources
order: 5
appRoutes: []
---

**Nodes** is under **Cluster** in the sidebar. The table shows each node's status, instance type, zone, Karpenter NodePool and capacity type, pod count, capacity, Kubernetes version, and CPU and memory use when metrics-server is installed. Filter with the column keys: `capacity-type:spot` finds spot nodes, and `zone:eu-west-1a` finds one zone's.

## A node's drawer

- **Summary**: its OS, architecture, kernel, container runtime, kubelet version, pod CIDR, provider ID, zone and region; **Capacity / Allocatable** for CPU, memory and pods; **Conditions** (Ready, MemoryPressure, DiskPressure, PIDPressure); and **Taints**.
- **Terminal**: a root shell on the node itself. See below.
- **YAML**: the live object.

## Node shell

Open a node's **Terminal** tab and click **Start node shell**.

Kubebay starts a short-lived helper pod pinned to that node. The pod is privileged, uses the host's PID, IPC and network namespaces, and tolerates every taint. It runs `nsenter -t 1 -m -u -i -n -p` to enter the node's own namespaces. That gives you a real root shell on the node: its filesystem, processes and network, not the helper pod's. It's the same approach Freelens takes.

The helper pod is deleted when you close the drawer.

The helper pod runs in the `default` namespace. Its image is `registry.k8s.io/e2e-test-images/busybox:1.29-2` unless you change it in [Settings](/docs/settings/#node-shell-image), for example to a mirror your cluster can pull from. `KUBEBAY_NODE_SHELL_IMAGE` sets it for an engine without Settings, such as one in a cluster. The image needs `nsenter`.

> A node shell is root on the node. Your identity needs permission to create privileged pods in `default`, and your cluster's admission policies, such as Pod Security `restricted` or `baseline`, may refuse them.

## Cordon, uncordon and drain

- **Cordon** marks the node unschedulable, so no new pods land on it. **Uncordon** undoes that.
- **Drain** cordons the node, then evicts its pods through the Eviction API. DaemonSet pods, static (mirror) pods and finished pods are skipped. Evictions respect PodDisruptionBudgets: if a PDB blocks a pod, Kubebay retries for a few seconds, then reports it as not evicted rather than deleting it. When it's done, it says how many pods were evicted and skipped.

Before draining, check [SPOF Radar](/docs/workloads-overview/#spof-radar) for workloads a drain would take down.
