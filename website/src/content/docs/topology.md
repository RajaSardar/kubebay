---
title: Topology
description: A namespace drawn as a graph of Deployments, StatefulSets, DaemonSets, ReplicaSets, pods and Services.
section: Tools
order: 7
appRoutes: ["/topology"]
---

**Topology** in the sidebar's Tools draws one namespace as a graph. Pick the namespace at the top.

The graph shows:

- each Deployment, with its ReplicaSets and their pods;
- each StatefulSet and DaemonSet, with their pods;
- each Service, linked to the pods its selector matches.

Each node shows its status. Click a pod to open its drawer, with its logs, terminal and the rest. See [Pods](/docs/pods/#a-pods-drawer). Drag to pan and scroll to zoom.

The graph is live: pods appear and disappear as they're scheduled and deleted.
