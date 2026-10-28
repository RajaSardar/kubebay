---
title: Install
description: The desktop app, the engine on its own, Docker, and a shared install in a cluster.
section: Getting started
order: 1
appRoutes: []
---

Kubebay comes in three forms. They're the same engine and the same app:

- **The desktop app.** A native window on macOS, Windows and Linux. Most people want this.
- **The engine on its own.** One binary that serves the app to your browser. Use it on a server, in a container, or when you'd rather not install a desktop app.
- **In a cluster.** A Helm chart that runs the engine for a team, behind your own sign-in.

All downloads are on the [latest release](https://github.com/RajaSardar/kubebay/releases/latest).

## macOS

```bash
brew install rajasardar/tap/kubebay
```

Or download the `.dmg` from the release and drag Kubebay to Applications. It's a universal build, for Apple Silicon and Intel.

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
| `--web-dist` | embedded | Serve the app from a directory instead |
| `--version` | | Print the version |

## In a cluster

The chart in [`charts/kubebay`](https://github.com/RajaSardar/kubebay/tree/main/charts/kubebay) runs the engine as a shared dashboard:

```bash
helm install kubebay charts/kubebay --set ingress.enabled=true --set ingress.host=kubebay.example.com
```

The chart's values cover OIDC, TLS and resources. In a cluster, Kubebay turns off what only makes sense on your own machine: the local terminal, AI assistants (MCP), AI triage and usage history.

## Verify a download

Every release asset has a `.sha256`, a keyless [cosign](https://docs.sigstore.dev/cosign/) signature (`.cosign.bundle`, from v0.8) and a GitHub build-provenance attestation:

```bash
shasum -a 256 -c kubebay-linux-amd64.tar.gz.sha256

cosign verify-blob kubebay-linux-amd64.tar.gz \
  --bundle kubebay-linux-amd64.tar.gz.cosign.bundle \
  --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify kubebay-linux-amd64.tar.gz --repo RajaSardar/kubebay
```

## Updates

The desktop app can update itself. It checks 30 seconds after launch, then once a day, and when you click **Check now** in [Settings → Updates](/docs/settings/#updates). The check is one request for `latest.json` on GitHub releases. A new version downloads in the background and is verified against Kubebay's signing key. Nothing installs until you click **Restart to update**, and the app won't restart while a terminal, port-forward or change is still running.

Homebrew installs update with `brew upgrade`, and `.deb` installs through your package manager.

## Build from source

You need Go 1.26 or later and Node 20 or later (`corepack enable pnpm`):

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay
make run    # builds the app and the engine, serves http://127.0.0.1:9898
```

The desktop app also needs a Rust toolchain: `cd desktop && corepack pnpm install && corepack pnpm tauri build`. [CONTRIBUTING.md](https://github.com/RajaSardar/kubebay/blob/main/CONTRIBUTING.md) has the rest.
