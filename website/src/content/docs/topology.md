---
title: Topology
description: A namespace drawn as a graph of workloads, pods and Services, and a Service map of who routes to, serves and is allowed to reach whom.
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

## Service map

The **Service map** tab, next to **Topology**, draws how traffic is set up to flow in the namespace you picked, from objects Kubebay already reads. It installs nothing.

- An Ingress is drawn with a line to each Service it routes to, labelled with its host and path.
- A Service is drawn with a line to each workload behind it, from its EndpointSlices. The Service shows how many endpoints are ready, for example `1/2 ready`.
- A NetworkPolicy that lets one workload's pods reach another's is drawn as a faded **allowed** line. Policies that name other namespaces or IP ranges are not drawn.
- A workload whose environment variables name a Service (`API_URL=http://api:8080`, `DB_HOST=postgres.data.svc`) gets a dashed **references** line to it. A Service in another namespace appears as a node marked `in <namespace>`.

Every line says how Kubebay knows it:

- **declared**: an object states it, such as an Ingress backend, an EndpointSlice or a NetworkPolicy.
- **inferred**: a guess. It is either a Service selector matched to pods because no EndpointSlice was seen, or a host found in an environment variable. An inferred line shows its evidence in its label, and the **inferred edges** checkbox hides them all.

Allowed lines are permissions, not traffic: they show what a policy lets through, and can be hidden with **allowed paths (NetworkPolicy)**.

**No live traffic.** The map shows no request rates, errors or latency, because the Kubernetes API does not see pod-to-pod traffic. A line means a path is set up, not that anything used it. For real traffic you need a mesh, an eBPF agent or your own metrics.

Click a node to open its drawer: an Ingress, a Service, or a workload. A route to a Service that does not exist is drawn as a red node reading "Service not found".

If your account can't list some of the kinds, the map says which, and the lines that depend on them are missing. If it can list none of what's needed, it says so instead of loading forever. An empty namespace shows "Nothing to map".
