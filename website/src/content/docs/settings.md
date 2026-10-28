---
title: Settings
description: Themes, fonts and density, Prometheus, the node shell image, usage history, AI features, extensions, updates and saved views.
section: Reference
order: 1
appRoutes: ["/settings"]
---

**Settings** is the last item in the sidebar's Tools.

## Display

- **Theme**: 12 themes in three groups, plus **System**.
  - Apple: **Dawn** (light, the default), **Dusk** (dark), **System** (follows your OS), and the high-contrast **Dusk HC** and **Dawn HC**.
  - VSCode: **VS Dark+** and **VS Light+**.
  - Community favourites: **One Dark**, **Dracula**, **Nord**, **GitHub Dark**, **GitHub Light** and **Catppuccin** (Mocha).

  **Reset to system** goes back to following your OS. Every theme meets WCAG contrast for text: 4.5:1, and 7:1 in the high-contrast themes.
- **Font size**: S (13px), M (14px), L (15px) or XL (16px).
- **Font family**: Roboto (the default), JetBrains Mono or System Mono.
- **Table density**: Compact, Default or Relaxed.

## Prometheus

Kubebay reads Prometheus for a pod's [graphs](/docs/pods/#graphs), right-sizing over 7 days, and GPU utilisation. Set **the default Prometheus URL** here, such as `http://localhost:9090`, for clusters that don't have their own. Set a cluster's own URL from its **⋮** menu on the [Clusters page](/docs/connect-clusters/#a-clusters-menu), since a port-forward usually reaches one cluster's Prometheus.

## Kubeconfig sources

Kubeconfig files are added and removed on the Clusters page, next to the clusters they bring in. **Manage kubeconfig files** takes you there. See [Connect your clusters](/docs/connect-clusters/#adding-kubeconfig-files).

## Node shell image

The image for the privileged pod behind [node shell](/docs/nodes/#node-shell). Set it to a mirror in your own registry if the cluster can't pull from `registry.k8s.io`.

## Usage history

Kubebay records hourly usage per namespace for the clusters you connect to, only while the app is open, and keeps it for 35 days. It stays on your computer, in Kubebay's folder in your user config directory. It powers the Clusters page's CPU sparkline, and the headroom forecast and unusual-usage cards on [Cost / Waste](/docs/cost-waste/#history-forecasts-and-anomalies).

Each cluster you've connected to is listed as **recording** or **stopped**. **Stop** and **Resume** control recording. **Clear** deletes a cluster's history.

Usage history isn't recorded when the engine runs in a cluster.

## AI assistants (MCP)

Lets an AI assistant such as Claude read the clusters you choose. See [AI assistants](/docs/ai-assistants/).

## AI incident triage

Adds a Triage tab to pods, which asks a model what's wrong. See [AI triage](/docs/ai-triage/).

## Extensions

Where `~/.kubebay/extensions.yaml` is, what Kubebay loaded from it, and why it skipped any entries. **Reload** reads the file again. See [Extensions](/docs/extensions/).

## Updates

In the desktop app only. **Check for updates automatically** turns the daily check on or off. **Check now** checks at once, and **Restart to update** installs a downloaded update. See [Install](/docs/install/#updates).

## Saved views

Every [saved view](/docs/interface/#saved-views): its name, table, namespaces and filter. Delete one, **Export** them all to a file, or **Import…** a file.
