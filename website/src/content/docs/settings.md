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

Kubebay reads Prometheus for a pod's [graphs](/docs/pods/#graphs), right-sizing over 7 days, and GPU utilisation.

**You usually don't need to set anything.** For each cluster, Kubebay looks for a Prometheus Service by its usual names and labels (`prometheus-server`, `kube-prometheus-stack-prometheus`, `prometheus-k8s`, `thanos-query`, `app=prometheus`, and so on), skipping Alertmanager, exporters and the operator. It then queries it through the cluster's API server, with your own credentials, so no port-forward is needed. This card shows `Auto-detected for <cluster>: monitoring/prometheus-server:80` with a **Change** button, which lists the other Prometheus services it found so you can pick one, or go back to the best match. **Use my own URL** in that dialog switches to a URL instead. The detection is cached for a few minutes and never holds up a page. If you aren't allowed to list Services, or none looks like Prometheus, the card says none was found and you set a URL. A URL you set always wins over auto-detection. To set one, set **the default Prometheus URL** here, such as `http://localhost:9090`, for clusters that don't have their own. Set a cluster's own URL from its **⋮** menu on the [Clusters page](/docs/connect-clusters/#a-clusters-menu), since a port-forward usually reaches one cluster's Prometheus.

Kubebay refuses a Prometheus URL that points at a cloud metadata or link-local address (such as `http://169.254.169.254`), at an address that isn't `http` or `https`, or that carries a user name and password, and the setting isn't saved. That keeps the engine from being aimed at a cloud node's credentials. A local address such as `http://localhost:9090` is fine on your own machine. When Kubebay runs in a cluster, loopback is refused too, since it's the engine's own pod.

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

In the desktop app only. **Check for updates automatically** turns the daily check on or off; the check only looks for a new version, it never downloads one. **Check now** checks at once, and **Update now** downloads and installs a version that was found. See [Install](/docs/install/#updates).

## Saved views

Every [saved view](/docs/interface/#saved-views): its name, table, namespaces and filter. Delete one, **Export** them all to a file, or **Import…** a file.
