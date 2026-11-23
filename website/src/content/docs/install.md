---
title: Install
description: The desktop app, the engine on its own, Docker, and a shared install in a cluster.
section: Getting started
order: 1
appRoutes: []
---

Kubebay comes in three forms. They're the same engine and the same app:

- **The desktop app.** A native window on macOS, with Windows and Linux builds in Preview (see below). Most people want this.
- **The engine on its own.** One binary that serves the app to your browser. Use it on a server, in a container, or when you'd rather not install a desktop app.
- **In a cluster.** A Helm chart that runs the engine for a team, behind your own sign-in.

All downloads are on the [latest release](https://github.com/RajaSardar/kubebay/releases/latest).

## macOS

```bash
brew install rajasardar/tap/kubebay
```

Or download the `.dmg` from the release and drag Kubebay to Applications. It's a universal build, for Apple Silicon and Intel.

Or install from the command line with the release's script:

```bash
curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install-mac.sh | bash
```

The script checks the download before it replaces the app. It compares the `.dmg` with the SHA-256 the release publishes next to it, and also checks the release's cosign signature if `cosign` is installed. If the checksum doesn't match, or the release publishes none, it stops and changes nothing. Only after the checks does it clear the quarantine flag that would otherwise make macOS refuse the first launch. Set `KUBEBAY_INSTALL_UNVERIFIED=1` to install a release that has no published checksum (older releases do not).

If macOS says **"Kubebay" Not Opened**, open it from **System Settings → Privacy & Security → Open Anyway**, or run:

```bash
xattr -dr com.apple.quarantine /Applications/Kubebay.app
```

## Windows and Linux

Each release has a Windows installer (`Kubebay_<version>_x64-setup.exe`) and Linux packages (`.deb` and `.AppImage`), for x86_64.

> These builds are **Preview**. CI builds, launches and checks them on every change, but no release has been tested by hand on Windows or Linux yet.

## The engine on its own

Download the archive for your platform from the release, extract it and run it:

```bash
tar xzf kubebay-linux-amd64.tar.gz
cd kubebay-linux-amd64
./kubebay
```

The engine prints its address and where it wrote this session's token:

```
kubebay engine listening addr=http://127.0.0.1:9898
session token written path=~/.config/kubebay/session-token
```

Open `http://127.0.0.1:9898` and paste the token when asked. The token changes every time the engine starts. A browser reload asks for it again, because the page keeps it in memory only. Set `KUBEBAY_TOKEN` to pin it.

On macOS you can also run the engine as a background service: `brew services start rajasardar/tap/kubebay`.

### Docker

```bash
docker run -d --name kubebay \
  -p 9898:9898 \
  -v ~/.kube:/home/nonroot/.kube:ro \
  ghcr.io/rajasardar/kubebay:latest
```

The token is in `docker logs kubebay`.

### Engine flags

| Flag | Default | What it does |
|---|---|---|
| `--addr` | `127.0.0.1:9898` | The address to listen on |
| `--kubeconfig` | `KUBECONFIG`, then `~/.kube/config` | A kubeconfig to read. `KUBEBAY_KUBECONFIG` overrides both |
| `--token-file` | `<config dir>/kubebay/session-token` | Where to write the session token (mode 0600) |
| `--no-open` | `false` | Don't open a browser on start |
| `--in-cluster` | `false` | Use the pod's ServiceAccount instead of a kubeconfig |
| `--oidc-issuer-url`, `--oidc-client-id`, `--oidc-client-secret`, `--oidc-redirect-url` | | Sign users in with OIDC (in-cluster installs) |
| `--prometheus-url` | | A Prometheus the engine queries directly for every cluster. On your own machine a URL set in Settings wins over it. In a cluster or with OIDC it's the only one used. `KUBEBAY_PROMETHEUS_URL` |
| `--prometheus-all-users` | `false` | With OIDC, let every signed-in user send queries to `--prometheus-url`. `KUBEBAY_PROMETHEUS_ALL_USERS=true` |
| `--helm-repos` | | Helm repositories to add at startup, as `name=url,name=url`. In a cluster or with OIDC it's the only way to change them. `KUBEBAY_HELM_REPOS` |
| `--web-dist` | embedded | Serve the app from a directory instead |
| `--version` | | Print the version |

## In a cluster

The chart in [`charts/kubebay`](https://github.com/RajaSardar/kubebay/tree/main/charts/kubebay) runs the engine as a shared dashboard:

```bash
helm install kubebay charts/kubebay --set ingress.enabled=true --set ingress.host=kubebay.example.com
```

The chart's values cover OIDC, TLS and resources. In a cluster, Kubebay turns off what only makes sense on your own machine: the local terminal, AI assistants (MCP), AI triage and usage history.

One engine serves everyone, so settings that apply to every user are read-only in the app, and **Save** on them says so. You set them in the chart's values instead:

| Value | Environment variable | What it sets |
|---|---|---|
| `nodeShellImage` | `KUBEBAY_NODE_SHELL_IMAGE` | The image of the privileged [node shell](/docs/nodes/#node-shell) pod |
| `debugImage` | `KUBEBAY_DEBUG_IMAGE` | The default image of a [debug container](/docs/pods/#terminal) |
| `prometheus.url` | `KUBEBAY_PROMETHEUS_URL` | A Prometheus the engine queries directly, for graphs and right-sizing |
| `prometheus.allUsers` | `KUBEBAY_PROMETHEUS_ALL_USERS` | With OIDC, let every signed-in user query `prometheus.url` |
| `helmRepos` | `KUBEBAY_HELM_REPOS` | The Helm repositories every user installs from, each a `name` and `url`. See [Helm](/docs/helm/#adding-and-removing-repositories) |

Leave `prometheus.url` empty and each user's queries go to an auto-detected Prometheus through the API server's service proxy, as that user, so RBAC decides who may query it. A URL you set answers for every namespace whatever a user's RBAC says, so with OIDC users only get it once you set `prometheus.allUsers: true`. Until then their queries fall back to the service proxy. The Kubernetes Service list and the proxy both need RBAC: `list` on `services` and `get` on `services/proxy`.

With OIDC, [Cost / Waste](/docs/cost-waste/#workload-usage-vs-requests) shows each person only the workloads in namespaces where they may list pods. See [Security and privacy](/docs/security/#in-a-cluster).

The audit log and settings live on a 64Mi `emptyDir`, so a pod restart loses them. The chart has no persistent volume option yet.

## Verify a download

Every release asset has a keyless [cosign](https://docs.sigstore.dev/cosign/) signature (`.cosign.bundle`, from v0.7) and a GitHub build-provenance attestation. The engine tarballs also have a `.sha256`:

```bash
shasum -a 256 -c kubebay-linux-amd64.tar.gz.sha256

cosign verify-blob kubebay-linux-amd64.tar.gz \
  --bundle kubebay-linux-amd64.tar.gz.cosign.bundle \
  --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify kubebay-linux-amd64.tar.gz --repo RajaSardar/kubebay
```

## Updates

The desktop app can update itself. It checks 30 seconds after launch, then once a day, and when you click **Check now** in [Settings → Updates](/docs/settings/#updates). The check is one request for `latest.json` on GitHub releases. When there's a newer version, an **Update available** button appears in the bottom-right corner of the window. Nothing downloads or installs on its own: click the button to read what changed, then **Update now**. The download is verified against Kubebay's signing key, and the app restarts. It won't restart while a terminal, port-forward or change is still running, and it says which. Copies installed before v0.8.0 carry no signing key and can't update themselves: install v0.8.0 once by hand and every later version updates from the app.

After an update, by hand or by the app, a **What's new in Kubebay** window opens once on the next start. It lists the changes in the new version grouped as Added, Changed, Fixed and Security, and in every version you skipped if you jumped several. **Full release notes** opens the release on GitHub; **Got it** or <kbd>Esc</kbd> closes it, and it doesn't come back for that version. It doesn't open on a first install or in a development build.

Homebrew installs update with `brew upgrade`, and `.deb` installs through your package manager.

Only builds that carry Kubebay's update key can do this, and every release does. Settings → Updates says **This build doesn't update itself** when the key is missing, as in an app you built from source without it. Each update is signed, and the app installs it only if the signature matches the key it was built with.

## Build from source

You need Go 1.26 or later and Node 20 or later (`corepack enable pnpm`):

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay
make run    # builds the app and the engine, serves http://127.0.0.1:9898
```

The desktop app also needs a Rust toolchain: `cd desktop && corepack pnpm install`, then `make desktop` from the repository root. If `~/.tauri/kubebay-updater.key.pub` exists, `make desktop` builds the app with that update key, so it can update itself; without it the app doesn't. (`corepack pnpm tauri build` in `desktop` builds without the key.) [CONTRIBUTING.md](https://github.com/RajaSardar/kubebay/blob/main/CONTRIBUTING.md) has the rest.
