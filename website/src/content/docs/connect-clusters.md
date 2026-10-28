---
title: Connect your clusters
description: The Clusters page, where clusters come from, and how to add EKS, GKE and AKS clusters without editing a kubeconfig.
section: Getting started
order: 2
appRoutes: ["/clusters"]
---

Kubebay reads your kubeconfig, so every context you can use with `kubectl` is already a cluster in Kubebay. It reads `KUBECONFIG` if it's set, or else `~/.kube/config`, and picks up changes to the file as you make them.

## The Clusters page

**Clusters** is the first page Kubebay opens. To come back to it later, click **Clusters** at the top of the sidebar.

Each row is one context:

- **Session**: **Active** for the cluster you're looking at, **Connected** for one that's streaming in the background.
- **API**: whether the engine can reach the API server. It shows **Reachable**, **Degraded**, **Unreachable** or **Config error**. Hover over it to see the error and when it was last checked.
- **Version**: the Kubernetes version.
- **Pods** and **Nodes**: counts for connected clusters. The pod bar shows healthy, pending and failing pods.
- **CPU · 7 days**: hourly peaks over the last week, from [usage history](/docs/settings/#usage-history).
- **Requests**: how much of the nodes' allocatable CPU and memory the pods request.

Search by name, context or server to narrow a long list. Click a row to connect and open the cluster's [Overview](/docs/workloads-overview/). A row with a config error opens its error instead.

### A cluster's menu

The **⋮** at the end of a row has:

- **Connect in background** keeps a cluster streaming without switching to it. **Disconnect** stops it. **Disconnect all**, above the list, stops every cluster.
- **Pin to top** keeps a cluster first in the list.
- **Rename…** sets a display name. Your kubeconfig isn't changed.
- **Change icon…** picks the icon shown in the cluster rail.
- **Copy context name** and **Copy server URL**.
- **Configure Prometheus…** sets this cluster's Prometheus URL, for history graphs. See [Settings](/docs/settings/#prometheus).
- **Open in Rancher** appears for clusters Rancher manages.
- **Remove from list…** hides a context from Kubebay. **Show** brings it back.

## Switching clusters

The **cluster rail** at the far left shows an icon for each cluster you're connected to. Click an icon to switch. Right-click one to change its icon. While Kubebay switches, it shows each step: credentials, the API server, then the live stream.

## Adding kubeconfig files

Click **Add kubeconfig** on the Clusters page to open **Kubeconfig sources**. It lists the files Kubebay has loaded. To add another, type its path and click **Add file**. Its contexts are merged with your default kubeconfig.

Tick **Use only the files listed above** to ignore `~/.kube/config` and `KUBECONFIG`, for example to keep work and personal clusters apart.

## Finding cloud clusters

The same dialog can find clusters in your cloud accounts, using the CLIs you already have:

- **Find EKS clusters** runs your `aws` CLI with a profile and regions you choose.
- **Find GKE clusters** runs `gcloud` for a project. Imports sign in with `gke-gcloud-auth-plugin`.
- **Find AKS clusters** runs `az` for a subscription. Only clusters that sign in with Microsoft Entra ID can be imported, through `kubelogin`.

Nothing runs until you click. An import writes a kubeconfig that Kubebay owns, in `~/.kubebay/discovered`. Your own kubeconfig is never changed.

## When you can't list namespaces

Some identities may only use a few namespaces. Kubebay still works for them. The namespace filter says **You can't list namespaces on this cluster** and offers the namespaces your kubeconfig context names. You can add others by typing them. Pages that read the whole cluster, such as the Overview, send you to Pods in those namespaces instead.
