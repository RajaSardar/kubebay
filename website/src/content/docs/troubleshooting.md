---
title: Troubleshooting
description: "Fixes for the problems people hit most: macOS blocking the app, a cluster that won't connect, missing graphs, and node shells that don't start."
section: Reference
order: 5
appRoutes: []
---

## macOS says "Kubebay" Not Opened

Open it from **System Settings → Privacy & Security → Open Anyway**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Kubebay.app
```

## The browser asks for a session token

Only the standalone engine asks. Its log names the token file:

```
session token written path=~/.config/kubebay/session-token
```

Paste the file's contents. The token changes each time the engine starts, and a page reload asks again. Set `KUBEBAY_TOKEN` to pin it.

## A cluster shows Config error

Kubebay couldn't use that context. Click the row to see the error. Common causes: the context names a user or cluster that isn't in the file, or a certificate path that doesn't exist.

## A cluster is Unreachable, or connecting never finishes

- Check the same context works in a terminal: `kubectl --context <name> get ns`.
- If it signs in with an exec plugin (`aws`, `gke-gcloud-auth-plugin`, `kubelogin`), the plugin must be on the `PATH` of your login shell, such as in `~/.zprofile`. The desktop app reads `PATH` from your login shell, not from a terminal you have open. Restart Kubebay after changing it.
- VPNs and proxies: the desktop app reads `HTTPS_PROXY`, `NO_PROXY` and CA settings from your login shell too.

## A page says I can't list something

Kubebay shows what your identity can do. A table you can't list shows the API server's own message. If you can't list namespaces at all, pick or type the namespaces you can use in the namespace filter. See [Connect your clusters](/docs/connect-clusters/#when-you-cant-list-namespaces).

## A pod's Graphs tab is empty

Graphs need Prometheus. Set its URL for the cluster from the **⋮** menu on the Clusters page, or a default in [Settings](/docs/settings/#prometheus). If Prometheus runs in the cluster, Kubebay gives you the `kubectl port-forward` command to reach it.

## The node shell doesn't start

Node shell creates a privileged pod in `default`. It fails if:

- your identity can't create pods there;
- an admission policy, such as Pod Security `baseline` or `restricted` on `default`, or Kyverno or Gatekeeper, refuses privileged pods;
- the cluster can't pull `registry.k8s.io`. Set a mirror in [Settings → Node shell image](/docs/settings/#node-shell-image).

## Terminal says this engine build has no local shell

The local terminal is part of the desktop app. The standalone engine and the container image don't include it. See [Terminal](/docs/terminal/#where-its-available).

## Vulnerabilities, Argo CD, Flux, Karpenter or KEDA say they're not installed

Those pages read the custom resources their operator installs. Kubebay checks for the operator's CRDs. Without them, the page says so. Kubebay can install Trivy-Operator for you.

## Still stuck

Search or open an issue on [GitHub](https://github.com/RajaSardar/kubebay/issues). Include your Kubebay version (`kubebay --version`), your OS, and the error text. Don't include your kubeconfig.
