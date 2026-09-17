# Installing Kubebay

Kubebay ships as a single self-contained binary (engine + embedded web UI) for macOS, Linux, and Windows.

## macOS

### Homebrew (recommended)

```bash
brew install rajasardar/tap/kubebay
kubebay
```

Runs as a foreground process, opens your browser, and prints a one-time session token.

As a background service (auto-starts at login):

```bash
brew services start rajasardar/tap/kubebay
# UI at http://127.0.0.1:9898 — token in `brew services info rajasardar/tap/kubebay`
```

Supports Apple Silicon (arm64) and Intel (amd64).

### Manual

Download from [releases](https://github.com/RajaSardar/kubebay/releases):

```bash
curl -LO https://github.com/RajaSardar/kubebay/releases/download/v0.1.0/kubebay-darwin-arm64.tar.gz
tar xzf kubebay-darwin-arm64.tar.gz
cd kubebay-darwin-arm64
./kubebay
```

## Linux

### Binary (all distros)

```bash
curl -LO https://github.com/RajaSardar/kubebay/releases/download/v0.1.0/kubebay-linux-amd64.tar.gz
tar xzf kubebay-linux-amd64.tar.gz
cd kubebay-linux-amd64
sudo mv kubebay /usr/local/bin/
kubebay
```

Also available for linux/arm64 (e.g. Raspberry Pi, Graviton).

### Homebrew on Linux

```bash
brew install rajasardar/tap/kubebay
kubebay
```

### Docker

```bash
docker run -d --name kubebay \
  -p 9898:9898 \
  -v ~/.kube:/home/nonroot/.kube:ro \
  ghcr.io/rajasardar/kubebay:latest
# UI at http://localhost:9898 — token in `docker logs kubebay`
```

### In-cluster (shared team dashboard)

```bash
helm install kubebay charts/kubebay --set ingress.enabled=true --set ingress.host=kubebay.corp.com
```

See [charts/kubebay](charts/kubebay/) for OIDC, TLS, and resource options.

## Windows

### Manual

Download `kubebay-windows-amd64.zip` from [releases](https://github.com/RajaSardar/kubebay/releases):

```powershell
Expand-Archive kubebay-windows-amd64.zip
cd kubebay-windows-amd64
.\kubebay.exe
```

Opens your default browser automatically. The engine reads `%USERPROFILE%\.kube\config` by default.

### Scoop (coming soon)

```bash
scoop bucket add rajasardar https://github.com/RajaSardar/scoop-bucket
scoop install kubebay
```

## From source

Prerequisites: Go ≥ 1.22, Node 20+ (`corepack enable pnpm`).

```bash
git clone https://github.com/RajaSardar/kubebay && cd kubebay
make run    # builds SPA + engine, serves at http://127.0.0.1:9898
```

## Desktop app (Tauri shell)

The native desktop shell is built separately:

```bash
cd desktop
corepack pnpm install
corepack pnpm tauri build   # produces .app / .dmg / .msi
```

Currently requires local Rust toolchain. Signed installers land in Phase 3.

---

## First run

1. `kubebay` starts on `http://127.0.0.1:9898` and writes this session's token
   to a 0600 file (`<user config dir>/kubebay/session-token`), logging the path
   but never the token
2. Open `http://127.0.0.1:9898` in your browser and paste the token when asked.
   The desktop app reads the file itself, so it never asks
3. The token is held in memory only, so a browser reload asks again; it changes
   on every engine restart. Set `KUBEBAY_TOKEN` to pin it instead
4. Your `~/.kube/config` is read and hot-reloaded; add extra kubeconfig files in Settings

## Flags

| Flag | Default | Description |
|---|---|---|
| `--addr` | `127.0.0.1:9898` | Listen address |
| `--kubeconfig` | *(KUBECONFIG / ~/.kube/config)* | Explicit kubeconfig path |
| `--web-dist` | *(embedded)* | Serve SPA from a directory instead |
| `--token-file` | *(user config dir)* | Where to write this session's token (0600) |
| `--no-open` | `false` | Don't auto-open the browser |
| `--in-cluster` | `false` | Use in-cluster ServiceAccount config |
| `--oidc-issuer-url` | | Enable OIDC login |
| `--oidc-client-id` | | OAuth2 client ID |
| `--oidc-client-secret` | | OAuth2 client secret |
| `--oidc-redirect-url` | | OAuth2 callback URL |
| `--version` | | Print version |
