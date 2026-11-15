---
title: Port forwarding
description: Forward a pod's port to your machine without keeping a terminal open, and manage every tunnel in one place.
section: Tools
order: 2
appRoutes: ["/ports"]
---

**Ports** in the sidebar's Tools manages port-forwards, so you don't need a terminal running `kubectl port-forward`.

## Start one

- **From a pod**: open the pod's drawer. On **Summary**, click a container's port.
- **From Ports**: pick the cluster, type the namespace, the pod's name and its port, and optionally a local port. Leave **local (auto)** empty to get a free one. Then click **Forward**.

## The list

Each tunnel shows its local address, its target pod and port, its cluster, and when it started. Click the local address to open it in your browser. **Stop** closes the tunnel.

Active forwards are also in the [command palette](/docs/interface/#the-command-palette).

## Good to know

- Tunnels bind to `127.0.0.1` only, so nothing else on your network can reach them.
- They stop when the engine stops. Quitting the desktop app closes them.
- Starting and stopping them is recorded in the [Audit Log](/docs/audit-log/).
