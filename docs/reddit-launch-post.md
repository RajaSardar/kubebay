# Reddit Launch Post — r/kubernetes

---

## POST

**Title:**
I built a Kubernetes desktop UI because Lens went subscription-only, k9s is TUI-only, and the official dashboard got archived. It's MIT, no accounts, no telemetry.

---

**Body:**

Hey r/kubernetes,

I've been running production EKS clusters for a while and the tooling situation genuinely started to bother me. Lens went closed-source with mandatory accounts and a subscription. OpenLens quietly died. The official Kubernetes Dashboard was archived in January 2026. Freelens is keeping the torch alive but it's still Electron — heavy memory footprint, slow cold start. k9s is great for terminal work but if you want something you can actually hand to a colleague who isn't comfortable in a TUI, it falls short.

So I built Kubebay.

It's a Tauri desktop app (Go backend, React frontend) that tries to be a genuine daily-driver Kubernetes IDE. Here's what it is in practice:

**What it actually does:**

- Every resource view is a live watch stream. No refresh button anywhere. Pods, deployments, events, all of it updates in real time via the Kubernetes watch API.
- Pod CPU and memory columns pulled from metrics-server with graceful degradation if it isn't installed.
- Split drawer — you can open logs and YAML side by side, resize the divider, pop out to a full page with ⌘⇧↵.
- ⌘K command palette that indexes live pod state. You can filter by crash loop, OOM killed, or just jump to any resource.
- ArgoCD integration — sync and health status badges, hard refresh, handles the not-installed case cleanly.
- Helm release browser.
- Network policy visualizer — connectivity matrix with click-to-explain cells.
- Audit log for exec/port-forward/scale/delete operations written to a local JSON-lines file. No cloud involved.
- RBAC explorer with a visual permission matrix and self-check.
- CRD browser that auto-discovers custom resources.
- Port-forward manager so you don't need to keep a terminal open.
- 13 themes including high-contrast.

**What it is not:**

Not a cloud product. Not a SaaS. No accounts. No telemetry (and I mean it — there is no phone-home code in the repo, check for yourself). Your kubeconfig never leaves your machine. The Go engine runs on localhost.

**Performance targets enforced in CI:**

- <= 150 MB idle RAM
- <= 1.5 s cold start
- <= 40 MB installer

It's MIT licensed. The governance model is documented — I'm the BDFL, there's a public roadmap, and the contribution path is written down. I'm not trying to build a startup here, I just wanted a tool I actually want to use every day.

**How to try it:**

Download the desktop app (macOS universal DMG, Windows x64, Linux AppImage/deb) or install the Go engine standalone and point a browser at it:

```
brew install rajasardar/tap/kubebay
```

Or one-liner for macOS to avoid Gatekeeper:

```
curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install-mac.sh | bash
```

Full instructions in the pinned comment below.

**What I'm looking for from this community:**

1. **Clusters and workloads to test against.** I test on EKS and kind locally. If you're running something unusual — large node counts, dense namespaces, lots of CRDs, GKE Autopilot, bare metal k3s, whatever — I'd genuinely like to know if things break. Open an issue or comment here.

2. **Missing features that would make this your daily driver.** The roadmap is public. What's the one thing that would make you switch from your current tool? I'm especially interested in gaps around multi-cluster workflows and anything on the platform engineering side.

3. **UX feedback.** I have opinions about information density and keyboard-first design, but I'm one person. If the drawer split is in the wrong place or the command palette is missing obvious shortcuts, tell me. Screenshots welcome.

4. **Contributions.** CONTRIBUTING.md has the full setup guide. The Go engine is straightforward, the React side is Vite + TanStack Query. If you want to fix something you found, PRs are open.

This is v0.1.x so there are rough edges. I'd rather ship something real and hear about the problems than wait until it's "perfect."

[github link]

---

---

## PINNED FIRST COMMENT (quick install)

**Quick install — all platforms**

**macOS (recommended — avoids Gatekeeper prompt):**
```bash
curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install-mac.sh | bash
```
Opens automatically after install. Reads `~/.kube/config` on startup.

**macOS via Homebrew:**
```bash
brew install rajasardar/tap/kubebay
```

**Windows:**
Download `Kubebay_VERSION_x64-setup.exe` from the releases page and run it. Standard installer, no admin rights needed for the app itself.

**Linux:**
```bash
# AppImage (no install, just run):
chmod +x kubebay_VERSION_amd64.AppImage && ./kubebay_VERSION_amd64.AppImage

# Or Debian/Ubuntu:
sudo dpkg -i kubebay_VERSION_amd64.deb
```

**Headless / server (Go binary, all platforms):**
```bash
# Extract the archive for your platform, then:
./kubebay
# Engine prints: http://127.0.0.1:9898/?token=<token>
# Open that URL in any browser.
```

**Homebrew as a background service:**
```bash
brew services start rajasardar/tap/kubebay
# UI at http://127.0.0.1:9898
# Token: brew services info rajasardar/tap/kubebay
```

All releases and checksums at: [github link]/releases

If something doesn't work on your setup, drop a comment here or open an issue — I check both.
