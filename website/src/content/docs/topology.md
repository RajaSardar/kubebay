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

- If the cluster has the **Gateway API** CRDs, a Gateway is drawn with a line to each Service its HTTPRoute or GRPCRoute `backendRefs` name, labelled with the route, its hostnames and any weight. A route with no parent Gateway is drawn as a node of its own. Only Service backends are drawn.
- If the cluster has **Istio**, a VirtualService is drawn with a line to each Service its `http`, `tls` and `tcp` destinations name (with the subset and weight), and a DestinationRule's subsets are drawn as **subset** lines from the Service to the workloads whose pods match the subset's labels.

Kubebay looks for these CRDs once through cluster discovery and follows them only when they exist. A cluster without them shows exactly the map above. Linkerd and Cilium/Hubble are not read: their resources and metrics are not drawn.

Every line says how Kubebay knows it:

- **declared**: an object states it, such as an Ingress backend, an EndpointSlice or a NetworkPolicy.
- **observed**: measured traffic from Prometheus, with a request rate and the time it was measured. See Observed traffic below.
- **inferred**: a guess. It is either a Service selector matched to pods because no EndpointSlice was seen, or a host found in an environment variable. An inferred line shows its evidence in its label, and the **inferred edges** checkbox hides them all.

Lines to a Service in another namespace (an env var, a route `backendRef` with a namespace, an Istio host such as `postgres.data.svc`) can be hidden with **other namespaces**, which also removes the nodes only they reach. The map still covers one namespace: Services elsewhere appear as a node marked `in <namespace>` with no endpoint counts.

Allowed lines are permissions, not traffic: they show what a policy lets through, and can be hidden with **allowed paths (NetworkPolicy)**.

**No live traffic by default.** The Kubernetes API does not see pod-to-pod traffic, so a line means a path is set up, not that anything used it.

### Observed traffic

If the cluster has a Prometheus (the one in **Settings**, or one Kubebay auto-detected), an **observed traffic (Prometheus)** checkbox appears for a single namespace. It does nothing until you tick it. Then Kubebay asks that Prometheus whether either of these metrics exists:

- `istio_requests_total` draws a line from the calling workload to the called workload, within the namespace.
- `nginx_ingress_controller_requests` draws a line from an Ingress to the Service it sends requests to.

Each observed line reads `traffic · observed · N req/s · time` (the rate over the last 5 minutes), and the exact PromQL and time are listed under the legend. Lines are drawn only between objects already on the map, and only for a non-zero rate. If neither metric exists, the map says **No traffic metrics found** and draws nothing; Kubebay never guesses at other metrics. Linkerd and Cilium/Hubble traffic are not read. The overlay is not available with **All namespaces**.

### All namespaces

On the **Service map** tab only, the namespace picker has **All namespaces**. Each namespace is drawn as a labelled group, and a reference to a Service in another namespace joins that Service's node. To keep the map usable it shows at most 400 nodes, in namespace order; past that a banner reads "Showing the first 400 of N nodes... Narrow by namespace to see the rest." The map follows the cluster's objects across every namespace only while this choice is selected. An account that can list only some namespaces sees the message about what it can't list.

**Findings** appear as chips above the map:

- **Service X has no ready endpoints**: a Service with a selector whose EndpointSlices have no ready endpoint, or that matches no pods. ExternalName and selector-less Services are not flagged.
- **Ingress X points at Service Y, which does not exist**: an Ingress, Gateway API route or Istio VirtualService names a Service the namespace doesn't have. The same Service is also drawn as the red node.

Click a node to open its drawer: an Ingress, a Service, or a workload. A route to a Service that does not exist is drawn as a red node reading "Service not found".

If your account can't list some of the kinds, the map says which, and the lines that depend on them are missing. If it can list none of what's needed, it says so instead of loading forever. An empty namespace shows "Nothing to map".
