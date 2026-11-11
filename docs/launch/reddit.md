# Reddit drafts

> Refreshed 2026-11-08 for v0.7 (the first draft was written for v0.1.x). Rewrite each one in your own words before posting. r/kubernetes has been complaining all year about AI-generated repo spam, and a post that *sounds* generated will be removed or downvoted whatever the project's quality.

**Rules for every subreddit:**

- Read the sidebar rules and any pinned self-promotion thread **the day you post**. Some subs only allow tools in a weekly thread; use that thread if so.
- Post from your own account, and comment in the sub for a week or two beforehand if your account isn't active there.
- One sub per day. Different angle, different text.
- Put the repo link in the body once. Install steps go in your first comment.
- Answer every comment. Don't argue with critics; thank them and open an issue.

---

## r/kubernetes (Day 1)

**Title:** I built a free, local Kubernetes desktop client that tells you what's fragile: SPOFs, NetworkPolicy gaps, attack paths. MIT, no account.

**Body:**

Lens wants an account even on the free tier, the official Dashboard was archived in January, and I wanted something I could hand to teammates who don't live in k9s. So for the last few months I've been building Kubebay.

It's a Go engine (shared informers, one WebSocket, everything live, no refresh button) behind a Tauri desktop app. The same engine can also serve the UI to your browser, or run in-cluster as a Helm chart with OIDC.

The everyday stuff is there: every kind and CRD as a live table, logs, exec, node shells, port-forwards, Helm (upgrade, rollback, values diff), YAML edits with a dry-run diff, ⌘K.

What I'd actually like feedback on is the analysis it does on top:

- **Single points of failure:** one replica, no PDB, every replica on one node
- **NetworkPolicy:** coverage gaps, a "can pod A reach B" check, a builder that dry-runs
- **Attack paths:** internet-facing Service or Ingress → image with critical CVEs → risky RBAC or node escape. Plus risky permissions, secrets in env vars, unused service accounts
- **Waste:** requests vs. real usage, with a dry-run right-sizing patch
- **Upgrade readiness:** APIs your cluster serves that the next release removes
- Argo CD / Flux drift, KEDA and Karpenter views, Trivy-Operator CVEs
- An optional MCP server, off by default, if you want Claude or similar to read your cluster and propose changes you approve one at a time

No telemetry, no account, kubeconfig never leaves your machine. Releases are cosign-signed with SBOMs.

Full disclosure: I'm one person, and I built this with a lot of help from Claude Code. Tests are written first and gate CI; the repo's CLAUDE.md shows the rules. It's v0.7, so expect rough edges. Windows and Linux are "preview", and the macOS app isn't notarized yet (that's next).

Repo: https://github.com/RajaSardar/kubebay

What I'm asking for: run it against your weirdest cluster and tell me what breaks. And if something here would make you switch from what you use now, or something missing stops you, I'd like to know that too.

**First comment (install):**

```
macOS:   brew install rajasardar/tap/kubebay
Windows: Kubebay_<version>_x64-setup.exe from the releases page
Linux:   .deb or .AppImage from the releases page
Any OS, no desktop app: download the kubebay-<os>-<arch>.tar.gz, run ./kubebay, open http://127.0.0.1:9898
In-cluster: Helm chart in charts/kubebay (see docs/install)
```

Docs: https://kubebay.sardar.dev/docs/

---

## r/devops (Day 2): angle is "the team member who isn't a k8s person"

**Title:** A Kubernetes GUI you can hand to the dev who doesn't live in kubectl: free, local, MIT

**Body focus:** the "what's broken and why" Overview ("1 of 2 available: keeps crashing on start"), AI triage that shows exactly what it would send before sending, saved views, the audit log of every change. Shorter than the r/kubernetes post. Link the repo once.

---

## r/sre (Day 3): angle is reliability

**Title:** Open-source tool that flags single points of failure and missing PDBs across your clusters

**Body focus:** the SPOF radar, Service/DNS health checks, headroom forecasts, upgrade readiness. Include one GIF of the SPOF view (gate G1). Ask what other fragility checks they'd want. That question tends to get comments, and comments give you the roadmap.

---

## r/homelab, r/k3s or r/selfhosted (Day 3–4): angle is a lightweight client for small clusters

**Title:** Lightweight Kubernetes GUI for my k3s homelab: single binary, runs in your browser, no account

**Body focus:** the headless binary or Docker image, ≤150 MB idle, 19–53 MB installers (check against `installer-sizes.json` of the latest release), and the in-cluster Helm chart. Check each sub's rules first: r/selfhosted has strict rules on self-promotion.

---

## Others to consider later (one at a time, only if the angle fits)

| Sub | Angle |
|---|---|
| r/aws, r/googlecloud, r/AZURE | "Add EKS / GKE / AKS clusters without editing a kubeconfig" (connect-clusters page) |
| r/golang | An engineering write-up: "How one Go process watches many clusters with shared informers", with Kubebay as the example. Not a product post. |
| r/rust or r/tauri | "Shipping a Go sidecar inside a Tauri app": lessons, installer sizes. |
| r/ClaudeAI, r/mcp | The MCP server: read-only by default, propose/approve, audit log. |
| r/opensource | Governance and MIT, "why I won't pull a Lens". |
