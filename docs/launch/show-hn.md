# Show HN draft

**Post at:** Tuesday–Thursday, ~8–9 am US Eastern. Submit from your own long-standing account. Don't ask anyone to upvote, since HN detects and penalises vote rings.

**URL field:** `https://github.com/RajaSardar/kubebay`. HN readers trust a repo over a landing page.

## Title (≤ 80 chars; pick one)

- `Show HN: Kubebay – a free, local-first Kubernetes IDE (Go + Tauri, MIT)`
- `Show HN: Kubebay – a Kubernetes desktop client that finds SPOFs and attack paths`

The first is safer. The second is the sharper hook if the GIFs (gate G1) show those views.

## First comment (post immediately, as the author)

> Write this in your own words. The facts below are checked against the repo; the voice should be yours.

Hi HN, I'm Raja. I run EKS clusters at work, and over the last year my options for a GUI kept getting worse: Lens went proprietary and needs an account even on the free tier, OpenLens stopped, the official Kubernetes Dashboard was archived in January, and k9s is great but hard to hand to a teammate who isn't at home in a TUI.

Kubebay is my attempt at the client I wanted. It's a Go engine that watches your clusters once (shared informers, metadata-only lists, one multiplexed WebSocket) and streams changes to a React UI. It runs three ways: a Tauri desktop app, a single binary that serves the UI to your browser, or a Helm chart in the cluster with OIDC.

The everyday parts are what you'd expect: live tables for every kind and CRD, logs, exec, port-forwards, Helm, YAML with a dry-run diff, ⌘K.

The part I'm most interested in feedback on is the "what's wrong with my cluster" layer:

- single points of failure (one replica, no PDB, all replicas on one node…)
- NetworkPolicy coverage gaps and a "can A reach B?" check
- attack paths: internet-facing entry point → vulnerable image → risky RBAC or node escape
- requests vs. actual usage, with a dry-run right-sizing patch
- APIs your cluster serves that the next Kubernetes release removes
- Argo CD / Flux drift, KEDA, Karpenter views
- an MCP server (off by default) so Claude or another client can read the clusters you choose, and propose changes you approve one by one

No account, no telemetry. The only network call it makes on its own is the update check, which you can turn off. Your kubeconfig stays on your machine. Every release artifact has a cosign signature and an SBOM next to it.

Honest caveats:

- It's v0.7 and I'm a solo maintainer.
- I built it with heavy AI assistance (Claude Code). The repo's `CLAUDE.md` shows the rules: tests first, and CI gates on Go and frontend tests, accessibility and contrast checks, and performance budgets (≤150 MB idle, ≤1.5 s cold start) measured on every PR. Judge the code, not the method, but I'd rather you hear it from me.
- **[Remove once KB-03 lands]** The macOS build isn't notarized yet, so Gatekeeper blocks it on first launch. A Developer ID is next on the list. Until then you can run the headless binary and use your browser: `./kubebay`, then open http://127.0.0.1:9898.
- Windows and Linux builds are tested in CI (launch + UI paint) but not yet by hand.

`brew install rajasardar/tap/kubebay`, or binaries for macOS/Windows/Linux on the releases page. Docs: https://kubebay.sardar.dev/docs/

I'd love to hear what breaks on your clusters, especially big ones, unusual distros, or lots of CRDs.

## Prepared answers (have these ready, don't paste them verbatim)

| Likely comment | Answer, in substance |
|---|---|
| "Why not k9s / Headlamp / Freelens?" | Be generous: they're good. k9s for terminal people, Headlamp is well governed (SIG UI). Kubebay's bet is the analysis layer plus the Go+Tauri footprint. Link [COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md). |
| "AI-written code, why trust it with prod?" | Read-only by default. Mutations go through a dry-run and are written to a local audit log. Tests gate CI. The engine binds to 127.0.0.1 with a session token. Link `website/src/content/docs/security.md` (the Security page of the docs). |
| "How do you make money / will this get rugpulled like Lens?" | MIT. ADR 0001 is the open decision. State what you've decided by then; if it isn't decided, say so honestly. |
| "Telemetry?" | None. Point to the code: only the update check, and it's toggleable. |
| "Electron?" | No: Tauri plus a Go sidecar, budgets measured in CI ([PERFORMANCE.md](../PERFORMANCE.md)). Give the actual installer sizes. |
| Bug report | Thank them, open an issue live, and link it in the thread. Fixing one during the launch is the best marketing there is. |

## If it doesn't take off

No comments usually means it wasn't seen, not that it was rejected. Don't delete it and repost the same day. Wait for a meaningful release (v0.8: signed, auto-updating, MCP) and come back with a new angle.
