---
title: Kubebay docs
description: How to install Kubebay, connect your clusters and use every page of the app.
section: Getting started
order: 0
---

Kubebay is a free Kubernetes IDE with its source in the open. It runs on your machine: a Go engine talks to your clusters with your own kubeconfig, and the app shows what it streams. There's no account and no cloud service. Apart from your clusters, the desktop app makes one request on its own, a daily check for updates that you can turn off. Anything else that sends data elsewhere, such as AI triage, stays off until you turn it on.

These docs are the manual. Each page covers one part of the app: what it's for, how to open it, what you'll see, and what it needs from your cluster.

## Where to start

- New to Kubebay? [Install it](/docs/install/), then [connect your clusters](/docs/connect-clusters/).
- Know Kubernetes but not Kubebay? [Find your way around](/docs/interface/): the sidebar, the namespace filter, the command palette (<kbd>⌘</kbd> <kbd>K</kbd>) and the table filter.
- Looking for one page of the app? Every page in the sidebar has its own page here, listed below.

## How the app is laid out

- **Clusters** is the first page you see. Pick a cluster and Kubebay opens its workloads.
- **The sidebar** has the cluster's resources, grouped as `kubectl` users expect (Workloads, Configuration, Network, Storage, and so on), then Kubebay's tools: Terminal, Helm, RBAC and the rest.
- **A drawer** opens when you click a row. It shows the object's summary, YAML, events and the actions you can take on it.

Everything you see is live. Kubebay watches the cluster, so a table changes as the cluster does, with no Refresh button.

## Licence

Kubebay is free for everyone to use, including at work, with no account and no licence key. From v0.8.0 its source is public under the Functional Source License (`FSL-1.1-MIT`): you can read, change, build and share it, but you can't sell it, rebrand it, or offer it as a paid service. Each release becomes MIT two years after it ships, and v0.7.10 and earlier stay MIT. The [LICENSE](https://github.com/RajaSardar/kubebay/blob/main/LICENSE) file is what applies.
