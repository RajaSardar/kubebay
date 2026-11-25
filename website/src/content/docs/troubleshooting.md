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

## Why can't I see metrics in pods?

A pod's **Graphs** tab draws CPU and memory from Prometheus. When it is empty, the tab now says why. Work down this list; **Test connection** (on the tab, and in [Settings](/docs/settings/#prometheus)) runs two small queries and shows the exact URL, the query and the HTTP status of each.

1. **`Prometheus: not found. Tried: ...`**: Kubebay found no Prometheus Service. It looks at every Service when you may list them all, otherwise only the usual monitoring namespaces, which the tab names, and it says in which ones you are not allowed to list Services. Pick one with **Choose a Service** (**Use this Service** pins it for this cluster only) or give a URL with **Enter URL**. A Prometheus you installed a minute ago is noticed within about a minute.
2. **`Forbidden: your account may not use services/proxy in <namespace>`**: Kubebay reads an in-cluster Prometheus through the API server's service proxy, with your own permissions. If your role may list Services but not use `services/proxy` there, ask for that, or enter a URL you can reach (for example a `kubectl port-forward`).
3. **`Could not connect`** with a URL: the URL is a dead port-forward or points at another cluster. A URL set for one cluster always wins for that cluster. The **default** URL from Settings is used only when no Prometheus is found in the cluster, so a stale default no longer hides the one the cluster has.
4. **`HTTP 404` or `503`**: the Service or port is wrong, the Service has no ready pods, or Prometheus runs under a path prefix. Choose another Service.
5. **`Prometheus answers but has no container_cpu_usage_seconds_total`**: this Prometheus is not scraping the kubelet's cAdvisor endpoint, so there is nothing to draw for any pod. Fix the scrape (kube-prometheus-stack does it by default), or choose a Prometheus that has it.
6. **`Prometheus answered, but returned no CPU or memory series for this pod`**: the pod may be newer than the chosen range, or your cAdvisor labels differ. Kubebay tries `pod` and `container`, then the older `pod_name` and `container_name`, then the pod's total, so this means none matched.

Why someone else sees graphs and you don't: it is usually what each of you is allowed to do (point 2) or a different URL setting (point 3). Not run against a live cluster: these checks are tested against fake Prometheus and API servers.

## The node shell doesn't start

Node shell creates a privileged pod in `default`. It fails if:

- your identity can't create pods there;
- an admission policy, such as Pod Security `baseline` or `restricted` on `default`, or Kyverno or Gatekeeper, refuses privileged pods;
- the cluster can't pull `registry.k8s.io`. Set a mirror in [Settings → Node shell image](/docs/settings/#node-shell-image).

## Terminal says this engine build has no local shell

The local terminal is part of the desktop app. The standalone engine and the container image don't include it. See [Terminal](/docs/terminal/#where-its-available).

## Vulnerabilities, Argo CD, Flux, Karpenter or KEDA say they're not installed

Those pages read the custom resources their operator installs. Kubebay checks for the operator's CRDs. Without them, the page says so. Kubebay can install Trivy-Operator for you.

## The engine uses a lot of memory or CPU

On a large cluster most of the engine's memory is the cached objects of the pages you have open; it lets go of a kind about two minutes after no page shows it. The engine sets no Go memory limit of its own. To cap it, start it with `GOMEMLIMIT` set (for example `GOMEMLIMIT=2GiB`); a limit below what the open pages need makes the garbage collector run constantly, so set it with room to spare.

To see where the memory goes, save a heap profile and attach it to an issue:

```
curl -H "X-Kubebay-Token: $(cat ~/.config/kubebay/session-token)" \
  http://127.0.0.1:<port>/api/debug/pprof/heap -o heap.pb.gz
```

`allocs` and `goroutine` work the same way in place of `heap`. A profile names engine functions and object counts, not your cluster's data.

## Still stuck

Search or open an issue on [GitHub](https://github.com/RajaSardar/kubebay/issues). Include your Kubebay version (`kubebay --version`), your OS, and the error text. Don't include your kubeconfig.
