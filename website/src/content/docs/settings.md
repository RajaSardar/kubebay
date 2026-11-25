---
title: Settings
description: Themes, fonts and density, Prometheus, the node shell image, the debug image, usage history, AI features, extensions, updates and saved views.
section: Reference
order: 1
appRoutes: ["/settings"]
---

**Settings** is the last item in the sidebar's Tools.

## Display

- **Theme**: 13 themes in four groups, plus **System**.
  - Apple: **Dawn** (light, the default), **Dusk** (dark), **System** (follows your OS), and the high-contrast **Dusk HC** and **Dawn HC**.
  - VSCode: **VS Dark+** and **VS Light+**.
  - Community favourites: **One Dark**, **Dracula**, **Nord**, **GitHub Dark**, **GitHub Light** and **Catppuccin** (Mocha).
  - Soft and light: **Blossom**, a light theme with a blush-pink page, white-pink cards and a deep rose accent.

  **Reset to system** goes back to following your OS. Every theme meets WCAG contrast for text: 4.5:1, and 7:1 in the high-contrast themes. That holds on the page and on the frame around it (the cluster rail, sidebar and status bar), which every theme draws in its own solid shade.
- **Font size**: S (13px), M (14px), L (15px) or XL (16px). Every size of text in the app follows it. No text is smaller than 11px at any setting, and names, IPs and other monospace text in tables are never smaller than 12px.
- **Font family**: Roboto (the default), JetBrains Mono or System Mono.
- **Table density**: Compact (28px rows), Default (32px) or Relaxed (40px). Compact also sets table text a step smaller, and Relaxed a step larger.

## Prometheus

Kubebay reads Prometheus for a pod's [graphs](/docs/pods/#graphs), right-sizing over 7 days, and GPU utilisation.

**You usually don't need to set anything.** For each cluster, Kubebay looks for a Prometheus Service by its usual names and labels (`prometheus-server`, `kube-prometheus-stack-prometheus`, `prometheus-k8s`, `thanos-query`, `app=prometheus`, and so on), skipping Alertmanager, exporters and the operator. It then queries it through the cluster's API server, with your own credentials, so no port-forward is needed. This card shows `Auto-detected for <cluster>: monitoring/prometheus-server:80` with a **Change** button, which lists the other Prometheus services it found so you can pick one, or go back to the best match. **Use my own URL** in that dialog switches to a URL instead. Besides the usual names it knows VictoriaMetrics (`vmselect`, `vmsingle`), Mimir and Cortex query frontends and OpenShift's `prometheus-k8s`, and the usual monitoring namespaces when you can't list every Service. A found Prometheus is cached for a few minutes and an empty result for about 30 seconds, and neither holds up a page. If none is found the card says `Prometheus: not found`, lists the namespaces tried and where Services could not be listed, and offers **Choose a Service** (**Use this Service** pins one for this cluster), **Enter URL** and **Test connection**. **Test connection** (also shown for a detected Prometheus) runs `vector(1)` and `count(container_cpu_usage_seconds_total)` and shows each query's URL, HTTP status and series count with the likely cause. See [Why can't I see metrics in pods?](/docs/troubleshooting/#why-cant-i-see-metrics-in-pods). A URL set for one cluster always wins over auto-detection. The **default Prometheus URL** here, such as `http://localhost:9090`, is a fallback for clusters where no Prometheus Service is found: it no longer overrides one that is detected, so a stale port-forward can't hide it. Set a cluster's own URL from its **⋮** menu on the [Clusters page](/docs/connect-clusters/#a-clusters-menu), since a port-forward usually reaches one cluster's Prometheus.

Kubebay refuses a Prometheus URL that points at a cloud metadata or link-local address (such as `http://169.254.169.254`), at an address that isn't `http` or `https`, or that carries a user name and password, and the setting isn't saved. That keeps the engine from being aimed at a cloud node's credentials. A local address such as `http://localhost:9090` is fine on your own machine. When Kubebay runs in a cluster, loopback is refused too, since it's the engine's own pod.

## When Kubebay runs in a cluster

One engine serves everyone in a cluster, or with OIDC sign-in, so the settings on this page that apply to every user are read-only: the Prometheus URLs and the pinned Prometheus Service, kubeconfig sources, the node shell image and the debug image. A banner at the top of the page says why. The **Default Prometheus URL**, **Node shell image** and **Debug image** fields, their **Save** buttons and **Change** next to an auto-detected Prometheus are turned off. The page shows the values the operator set, through the Helm chart's values or the engine's environment. See [Install in a cluster](/docs/install/#in-a-cluster).

## Kubeconfig sources

Kubeconfig files are added and removed on the Clusters page, next to the clusters they bring in. **Manage kubeconfig files** takes you there. See [Connect your clusters](/docs/connect-clusters/#adding-kubeconfig-files).

## Node shell image

The image for the privileged pod behind [node shell](/docs/nodes/#node-shell). Set it to a mirror in your own registry if the cluster can't pull from `registry.k8s.io`.

## Debug image

The image **Debug with ephemeral container** offers in a pod's [Terminal tab](/docs/pods/#terminal). Leave it empty for the default (`busybox:1.36`), or set one with the tools you want (`nicolaka/netshoot`) or a mirror in your own registry.

## Usage history

Kubebay records hourly usage per namespace for the clusters you connect to, only while the app is open, and keeps it for 35 days. It stays on your computer, in Kubebay's folder in your user config directory. It powers the Clusters page's CPU sparkline, and the headroom forecast and unusual-usage cards on [Cost / Waste](/docs/cost-waste/#history-forecasts-and-anomalies).

Each cluster you've connected to is listed as **recording** or **stopped**. **Stop** and **Resume** control recording. **Clear** deletes a cluster's history.

Usage history isn't recorded when the engine runs in a cluster, or when OIDC sign-in is configured: the history is collected with the engine's own access, not each user's, so one person would see usage from namespaces their RBAC hides. Connecting doesn't turn it on there, and nobody can turn it on or erase it.

## Change timeline

**Keep changes for** sets how long the [Changes](/docs/changes/) page's local record is kept: **Off**, 1, 3, 7 (the default), 14 or 30 days. The card shows how many changes are stored and how much of the 100 MB cap they use. **Clear** deletes the record, and **Off** deletes the file. It is not kept when the engine runs in a cluster or with OIDC or an auth proxy: the card then says why.

## Warm clusters

How many connected clusters keep streaming live, and for how long one you haven't looked at stays warm. Set **Warm clusters** (0 to 50, 0 for no limit) and **Idle minutes** (0 to 1440, 0 for never), then **Save**; the engine applies it at once, and lowering the number puts the extra least recently viewed clusters to sleep right away. **Reset to defaults** puts back 5 clusters and 30 minutes. The cluster you're on and your pinned clusters never go to sleep. A value saved here wins over the `--warm-clusters` and `--warm-idle` flags. The fields are disabled, with the reason, when Kubebay runs in a cluster or with OIDC, where streams are shared between users. See [Switching clusters](/docs/connect-clusters/#switching-clusters).

## AI assistants (MCP)

Lets an AI assistant such as Claude read the clusters you choose. If the engine was started with `--mcp-read-only`, **Let assistants propose changes** is disabled with the reason. It is also disabled, unticked, on a shared engine (in a cluster, with OIDC or behind an auth proxy), where MCP is off and only the operator can change it. See [AI assistants](/docs/ai-assistants/#read-only-mode).

## AI investigations (Claude Code)

**Allow Investigate with AI** turns the button on Issues and in pod and workload drawers on or off for you. It shows where Claude Code was found, or how to install it, and is disabled with the reason when the engine runs in a cluster or with OIDC or an auth proxy. See [AI assistants](/docs/ai-assistants/#investigate-with-ai-claude-code).

## AI incident triage

Adds a Triage tab to pods, which asks a model what's wrong. See [AI triage](/docs/ai-triage/).

## Extensions

Where `~/.kubebay/extensions.yaml` is, what Kubebay loaded from it, and why it skipped any entries. **Reload** reads the file again. See [Extensions](/docs/extensions/).

## Notifications

In the desktop app only. **Notify me about new issues** is off by default. Turning it on asks the operating system for permission to show notifications: on macOS the first one brings up its prompt, and if you refuse, or have turned Kubebay off under System Settings, Notifications, the switch stays off and says so. **Notify for** sets the lowest severity (Critical only by default), and **Mute a cluster** silences one cluster. The choices are kept for you in this app only. See [Desktop notifications](/docs/issues/#desktop-notifications) for what is and is not sent.

## Updates

In the desktop app only. **Check for updates automatically** turns the daily check on or off; the check only looks for a new version, it never downloads one. **Check now** checks at once, and **Update now** downloads and installs a version that was found. See [Install](/docs/install/#updates).

## Saved views

Every [saved view](/docs/interface/#saved-views): its name, table, namespaces and filter. Delete one, **Export** them all to a file, or **Import…** a file.
