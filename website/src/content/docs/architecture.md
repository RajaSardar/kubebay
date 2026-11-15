---
title: How Kubebay works
description: One Go engine that watches your clusters once and streams changes to the app, and why the app stays live without a Refresh button.
section: Reference
order: 4
appRoutes: []
---

Kubebay is two parts:

- **The engine**, one Go binary. It holds your cluster connections, watches the API servers, and serves the app and its API.
- **The app**, a React page. The desktop app shows it in a native window (Tauri), with the engine started beside it. The standalone engine serves it to your browser.

## Watch once, stream to everyone

When a page asks for a kind, such as the pods in two namespaces, the engine starts one watch for that cluster and kind, the way `kubectl get -w` does. Every page and tab that wants the same kind shares that one watch, so ten open tabs cost the cluster the same as one.

The engine sends the page a snapshot of what exists, then each change as it happens. That's why tables update by themselves, and why there's no Refresh button.

- A watch starts when something first asks for it, and stops five minutes after the last page stops looking. Memory follows what you look at, not everything in the cluster.
- Tables that only need names, labels and status watch **metadata only**. Pages that need the whole object, such as Pods with their containers, watch it in full.
- Before an object is cached, the engine drops the parts no page reads, such as `managedFields`.
- A big snapshot is sent a frame at a time, so the engine never builds a copy of every object at once.

## Writes

Changes go straight to the API server: no shadow database. The YAML editor sends a patch of what you changed, and checks that no one changed the same fields since you opened it. **Dry run** asks the API server to validate a change, including admission webhooks, without saving it.

## Custom resources

Kinds come from the API server's discovery, so a CRD installed a minute ago has a table, columns and a drawer like any built-in kind, with no code for it.

## Logs, shells and port-forwards

The engine streams logs, container shells and port-forwards through the Kubernetes API, over WebSocket where the cluster supports it, falling back to SPDY on older clusters.

For the design in depth, see [ARCHITECTURE.md](https://github.com/RajaSardar/kubebay/blob/main/docs/ARCHITECTURE.md) and [PERFORMANCE.md](https://github.com/RajaSardar/kubebay/blob/main/docs/PERFORMANCE.md).
