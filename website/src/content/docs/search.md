---
title: Search all clusters
description: Find an object by name, or by kind and name, in every cluster at once, including the ones you haven't connected.
section: Tools
order: 3
appRoutes: ["/search"]
---

**Search all clusters** in the sidebar's Tools finds objects by name in every cluster in your kubeconfig, and lists each one with its **Cluster**, **Kind**, **Namespace** and **Name**. Click a result to open its cluster and the object's drawer (a pod opens in the Pods list). In the [command palette](/docs/interface/#the-command-palette), **Search all clusters for "…"** opens this page with what you typed.

Type the way you would in the palette: a name or part of one (`checkout`), or a kind and a name (`deploy api`, `svc:web`, `pod checkout`). A kind on its own followed by a space (`ing `) lists that kind's objects alphabetically. What you type is kept in the address, so you can bookmark or share a search.

## Connected clusters

The clusters you've connected are searched as you type, the same way the palette's **All clusters** searches them: from what Kubebay already holds, and from the kinds the engine follows for search. Opening one of these results is instant.

## Clusters that aren't connected

Clusters you haven't connected aren't searched until you ask. When there are some, the page says how many weren't searched, with **Also search N disconnected clusters**. Clicking it searches them without connecting them: they don't open streams, don't count against the number of clusters Kubebay keeps warm, and stay disconnected. **Connected clusters only** turns it off again.

For each such cluster Kubebay lists only the names of a fixed set of kinds: Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Services, Ingresses, ConfigMaps and Namespaces. A query that names one of them lists only that kind. Custom resources and other kinds aren't searched in clusters that aren't connected; the page says so if you name one.

- Results arrive as each cluster answers. While some are still being searched the page says **Still searching N clusters. More may appear.**
- Ten clusters are searched at a time, and each has about 12 seconds. A cluster that can't be reached, or whose credential plugin is slow, is named with the reason, and isn't asked again for a minute.
- The names a cluster returned are kept for a minute, so the next query over the same clusters answers at once.
- A very large kind is searched up to 5,000 objects, and the page names it when it hit that limit.

## Your access

Every search runs as you: with [OIDC sign-in](/docs/security/) it lists as your user, so you only find what you could list yourself. A kind your account may not list isn't an error: the page names the cluster and the kind (**your access can't list Deployments**) and searches the rest.

## How many results

The page lists the best 200 matches across all clusters, best first: an exact name, then names that start with what you typed, then names with a word that does, then the rest. When there are more, it says **Showing the first 200 of N**. Add words to narrow it down.
