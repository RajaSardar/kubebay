---
title: Find your way around
description: The sidebar, the namespace filter, the command palette, table filters, favourites, saved views and keyboard shortcuts.
section: Getting started
order: 3
appRoutes: ["/view/:id"]
---

## The sidebar

The sidebar starts with **Clusters**, which goes back to the [cluster list](/docs/connect-clusters/), and **Search…**, which opens the command palette. Below them:

- **Navigate**: the [Overview](/docs/workloads-overview/), then the cluster's resources in groups: Workloads, Configuration, Network, Storage, Devices (DRA), Access Control, Admission and Cluster. Click a group to open it.
- **Custom Resources**: every custom resource kind on the cluster, grouped by API group. See [CRDs](/docs/crds/).
- **Favorites** and **Saved views**, once you have some.
- **Tools**: Terminal, Create Resource, CRDs, Ports, Helm, ArgoCD, Flux, RBAC, Vulnerabilities, Right-sizing, Cost / Waste, Karpenter, KEDA, Upgrade Readiness, Audit Log, Timeline, Topology and Settings.

Press <kbd>⌘</kbd> <kbd>B</kbd> (<kbd>Ctrl</kbd> <kbd>B</kbd> on Windows and Linux) to hide the sidebar and get the width back. Press it again, or click the button on the cluster rail, to bring it back.

## The namespace filter

Most pages have a namespace filter. Pick one namespace, several, or **All namespaces**. The choice is shared across pages and remembered for each cluster.

On clusters managed by Rancher, namespaces are grouped by Rancher project.

## The command palette

Press <kbd>⌘</kbd> <kbd>K</kbd> (<kbd>Ctrl</kbd> <kbd>K</kbd>) anywhere to open the palette, then type to search:

- every page and resource kind;
- your saved views;
- your clusters, to switch to one;
- active port-forwards;
- the live pods of the current cluster, by name, namespace or status.

Use <kbd>↑</kbd> and <kbd>↓</kbd> to move, <kbd>Enter</kbd> to open, and <kbd>Esc</kbd> to close.

## Filtering a table

Every resource table has a filter box. Press <kbd>/</kbd> to jump to it, and <kbd>Esc</kbd> in the box to clear it. It understands a small query language:

| You type | It matches |
|---|---|
| `web` | rows that show `web` anywhere. Every word must match |
| `ns:shop` | rows in namespace `shop` (`namespace:` works too) |
| `name:api` | rows whose name contains `api` |
| `status:running` | a column's value. Any column with a filter key works, such as `node:` |
| `label:app=web` | rows with label `app` set to `web`. `label:app` matches any value, and `l:` is short for `label:` |
| `-word`, `-ns:kube-system` | rows that **don't** match |

Matching ignores case, except label keys and values, which Kubernetes compares exactly. A `key:value` the table doesn't know, such as `system:node`, is matched as plain text.

Click a column header to sort by it. The **Columns** button shows, hides and reorders columns; Name always stays first. Drag a header's edge to resize it. Kubebay remembers your columns and sort for each kind.

Tick rows to select them, then delete them together. The bar above the table says what the selection covers, including rows the filter hides, and **Deselect hidden** drops those. <kbd>Esc</kbd> clears the selection.

## Moving through a table with the keyboard

| Key | Does |
|---|---|
| <kbd>↓</kbd> or <kbd>j</kbd> | next row |
| <kbd>↑</kbd> or <kbd>k</kbd> | previous row |
| <kbd>Enter</kbd> | open the row |
| <kbd>x</kbd> | select the row |
| <kbd>/</kbd> | jump to the filter |

Keys are ignored while you're typing in a field, or while a drawer or dialog is open.

## Favourites

Click the **☆** next to a resource table's title to add it to **Favorites** in the sidebar. Click **★** to remove it.

## Saved views

A saved view keeps a table as you have it: the cluster, the kind, the namespaces, the filter, the columns and the sort. Click **Save view** on a resource table and give it a name, such as *Crashing shop pods*.

Saved views are listed in the sidebar and in the command palette. Opening one switches to its cluster and opens its table. In [Settings](/docs/settings/#saved-views) you can delete them, **Export** them to a file, and **Import…** a file, for example one a teammate shared.

## Keyboard shortcuts

| Shortcut | Does |
|---|---|
| <kbd>⌘</kbd> <kbd>K</kbd> | open the command palette |
| <kbd>⌘</kbd> <kbd>B</kbd> | hide or show the sidebar |
| <kbd>/</kbd> | jump to a table's filter |
| <kbd>j</kbd> <kbd>k</kbd> <kbd>Enter</kbd> <kbd>x</kbd> | move, open and select in a table |
| <kbd>Esc</kbd> | close a drawer, dialog or the palette |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>Enter</kbd> | open a resource's drawer as a full page |
| <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>S</kbd> | split a resource's drawer, to see two of its tabs side by side |

On Windows and Linux, use <kbd>Ctrl</kbd> for <kbd>⌘</kbd>.
