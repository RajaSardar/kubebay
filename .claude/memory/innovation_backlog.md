---
name: Innovation & enterprise-feature backlog
description: Running list of proposed Kubebay features (visualizations, autoscaler wizards, MCP server, cost optimization, enterprise tier) with status and scoping notes
type: roadmap
---

## How this file works

- This is a living backlog, not a spec. Entries start as a one-paragraph `idea` and only grow into a real design once someone (Raja or an `innovation-scout` pass) commits time to it.
- Status values: `idea` (raw, unscoped) → `scoping` (an innovation-scout pass produced a spec below the entry) → `building` (a branch/PR exists — link it) → `shipped` (merged — link the PR) → `parked` (explicitly deprioritized, with why).
- Use the **`innovation-lab`** skill to add, triage, or list entries conversationally. Use the **`innovation-scout`** agent to turn one `idea` into a scoped spec (architecture fit + phased plan + effort) without committing to building it yet.
- Entries tagged **[Enterprise]** are candidates for a paid/enterprise tier rather than the OSS core — see the split below before scoping one as free.
- Adding an entry here is not permission to build it. Nothing in this file gets implemented without Raja explicitly asking for that specific item.

## Open-core split (working assumption — confirm with Raja before monetizing anything)

Kubebay OSS stays the complete local-first single/multi-cluster IDE — everything shipped through v0.2.0, plus straightforward additions in the same spirit (more resource kinds, more visualizations, more drawer tabs). Enterprise-tier candidates are the ones that need either:
- (a) a control plane beyond one user's laptop — fleet-wide policy, SSO, centralized audit export, or
- (b) opinionated automation on top of a complex third-party controller (KEDA, Karpenter, VPA) where a guided wizard + guardrails is genuinely worth paying for over hand-writing the CRD yourself.

## Backlog

### 1. More visualizations — status: idea
Kubebay already has live CPU/mem progress bars (NodeSummary), health-ratio bars (WorkloadsOverview), a dependency graph (Topology/`topology.ts`), and Prometheus-backed time-series charts (`PodGraphs.tsx` + `engine/internal/httpapi/promquery.go`). Gaps worth exploring:
- A namespace × node resource-usage heatmap/treemap (who's actually consuming the cluster).
- Warning-event frequency heatmap over time, per namespace/kind — surfaces flapping workloads before they page someone.
- An RBAC access graph (which subjects can do what, visually) — natural extension of the existing RBAC page's `KIND_MAP`.
- "What-if" capacity view: show projected node utilization if a given workload were rescheduled/scaled.
Mostly OSS — visualization of data Kubebay already streams.

### 2. Easy KEDA enable — status: idea [Enterprise-leaning wizard, OSS-friendly detection]
Detect whether KEDA's CRDs (`scaledobjects.keda.sh`, `scaledjobs.keda.sh`) are present via the engine's existing CRD discovery. If absent, offer a guided Helm install (Kubebay already drives Helm through the engine's Helm SDK integration). If present, add a "Scale with KEDA" wizard on a Deployment's detail view: pick a trigger (cron, Prometheus query, queue length, CPU), generate a `ScaledObject`, and route it through the existing dry-run + diff-before-apply pattern (already a Kubebay differentiator over kubectl) instead of a raw YAML paste.

### 3. Easy Karpenter enable — status: idea [Enterprise]
Same detect-or-install shape as KEDA, but cloud-provider aware (Raja's own clusters are EKS — start there: `ec2nodeclasses.karpenter.k8s.aws`, `nodepools.karpenter.sh`). Wizard walks through instance-type selection, disruption budgets, and consolidation policy with sane EKS defaults, then shows which nodes are Karpenter-managed vs. static in the existing Nodes view. Real value-add is the guardrails (Raja is "extremely sensitive about prod safety" — see `user_raja.md`) — a bad NodePool can evict prod capacity, so this should default to dry-run + an explicit confirm banner, same as delete flows today.

### 4. Intelligent VPA enable — status: idea
`VerticalPodAutoscaler` is already registered in the resource registry (this session). "Intelligent" layer on top: read the VPA recommender's `.status.recommendation` and surface it as an actionable banner on the owning Deployment/Pod's detail view — e.g. "requests are 3× the VPA recommendation — apply?" — with a one-click patch to `resources.requests/limits`. Must work even when `updateMode: Off` (recommendation-only), since that's the safe default for prod and matches how Raja actually runs VPA. This is the single highest-leverage "cost" feature since over-provisioned requests are most clusters' #1 waste source.

### 5. MCP server — status: idea
Expose Kubebay's own engine as an MCP server, fronting the existing REST/WebSocket API (`engine/internal/httpapi`) with an MCP tool adapter. Read-only tools first (list/get/describe resources, tail events, query logs); any write tool (scale, delete, patch) gated behind the same in-app confirm-banner UX already used for deletes, plus an audit-log entry via the existing `engine/internal/audit` package. This turns Kubebay into the trust boundary between an AI client (Claude Desktop, Claude Code, etc.) and a real cluster — arguably the most differentiated idea on this list, since no competitor (Lens, Freelens) has this.

### 6. Out-of-the-box cost optimization — status: idea [Enterprise for the multi-cluster rollup]
No cost data exists in Kubebay today. Phased approach:
- OSS: an idle-resource finder using metrics Kubebay already streams (requests ≫ actual usage → flag it), reusing the "more visualizations" heatmap.
- OSS: static per-node cost estimate from a bundled cloud instance-type price table (AWS/GCP/Azure), so a namespace's node-hours can be priced without an external billing API.
- Enterprise: multi-cluster cost rollup, historical trend export, and Karpenter-consolidation suitability scoring (ties directly into idea #3).

### 8. kubectl-based backend (à la Freelens) — status: idea (debate in progress)
Raja asked whether Kubebay should add a "kubectl-based backend like Freelens." Freelens actually has two separate kubectl-adjacent things, not one: (1) a `Kubectl` class that downloads/checksum-verifies a pinned kubectl binary purely so its embedded terminal has `kubectl` on PATH, and (2) a completely separate compiled `kube-auth-proxy` binary spawned per cluster to handle real API auth — needed because Freelens's main process is Node.js/Electron, which has no native equivalent to client-go's exec-credential/cloud-auth handling. Kubebay's engine is already a Go process built directly on client-go — the same library that proxy binary wraps — so the premise needs scrutiny before assuming Kubebay is missing something Freelens has. Four independent experts are debating this now (compatibility realist, architecture purist, terminal-UX advocate, security/maintenance skeptic); a decisive verdict will replace this paragraph.

### Further ideas worth a look (unscoped, one-liners)
- **GitOps drift detector** — Kubebay already has an ArgoCD "Hard Sync" action; extend it to a standing drift view (live state vs. Git source) for Argo/Flux-managed resources.
- **Policy-as-code browser** — OPA Gatekeeper / Kyverno constraint list with plain-English violation explanations on the resources that fail them.
- **AI-assisted incident triage** — feed recent Warning events + logs for a workload into an LLM for a root-cause summary; natural pairing with the MCP server idea (could reuse the same tool surface).
- **Fleet / multi-cluster dashboard** — a single pane across all configured clusters, not just the per-cluster WorkloadsOverview that exists today. [Enterprise]
- **Least-privilege RBAC advisor** — diff granted permissions against permissions actually exercised (driven by the existing audit logger) and suggest tighter Roles.
- **SBOM / vulnerability scan surfacing** — show Trivy/Grype findings for the images already visible in a Pod's detail view.
- **Admission-webhook debugger** — when a resource is rejected, show which ValidatingWebhookConfiguration/policy rejected it and why, instead of surfacing the raw API error.
