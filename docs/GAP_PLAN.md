# Gap plan: Rancher vs Lens/Freelens vs Kubebay (backlog 12)

Date: 2026-11-18. Inputs: `docs/COMPETITIVE_ANALYSIS.md`, `docs/research/2026-11-12-lens-freelens/` (verdict.md is the cross-checked source), `docs/PARITY_FRELENS.md`, the website's "Where Kubebay goes further" table, and the current sidebar and pages.

Evidence rule: "(unverified)" marks an outside claim nobody re-read from a primary source in this pass; it is carried from the research files or from memory. Other tools are described as "not documented", never "lacks". Where the research verdict (2026-11-12) disagrees with today's code, the code wins and the row says so.

## 1. Gap matrix

Effort: S = under a day, M = a few days, L = a week or more or needs infrastructure. Value: H/M/L for Kubebay's audience (a daily driver for people who run clusters, desktop first).

| Feature | Rancher | Lens / Freelens | Kubebay today | Effort | Value |
|---|---|---|---|---|---|
| Logs/Terminal open on the pod's `default-container` annotation | Not itemised (unverified) | Freelens has it (v1.10.3); Lens not documented | Was missing; **done in this change** | S | M |
| Secret values masked in the drawer, click to reveal, audited | Not itemised (unverified) | Freelens: reveal-on-click (source) | **Shipped**: `HandleGetYAML` masks unless `reveal=true` and audits the reveal (the 2026-11-12 verdict item 7 is stale). Docs: security.md should say so; check the YAML editor refuses to apply a masked Secret | S (verify) | H |
| Helm release in the Owned-by chain | Apps view (unverified) | Freelens Resource Map relates pods to Helm releases | Chain was ownerReferences only; **done in this change** (Helm release tops the chain, links to the release drawer; pods.md now accurate) | S/M | M |
| Pod Terminal ephemeral debug container (distroless) | kubectl shell only (unverified) | Not documented | Said "image has no shell"; **done in this change** (Debug with ephemeral container, unit-tested, not yet run on a live cluster) | M | H |
| Cross-cluster search (palette "where is this pod?") | Yes, in a fleet UI | Not documented | Removed Fleet page by choice; analysis suggests on-demand search | M | M |
| Cloud cluster discovery (EKS/GKE/AKS) | Register/import (yes) | Lens Plus (paid) | Scan via your own CLI; code partly untested | M | M |
| Auto-update, signed and notarised builds | n/a (server) | Both have it | Updater built, key not shipped in v0.7.0 | L | H |
| Windows/Linux tested builds | n/a (browser) | Both | Labelled Preview | L | M |
| Extensions API (code) | Vue UI extensions | Lens Plus, Freelens TS ext. | Declarative YAML columns/actions only; WASM later | L | M |
| Helm chart store (Artifact Hub-style) | Apps and catalog | Charts view | First slice shipped (backlog 11), open | L | M |
| MCP server | Behind paid Liz (unverified) | Lens Plus+; Freelens clients only | Shipped, read-only, free | done | H |
| In-app AI | Liz (Prime only) | Lens Ask AI (Plus); Freelens AI ext. | AI Triage, off by default | done | M |
| Pod resize, force delete, node shell, port-forward manager | Partial | Freelens has all four | Shipped (resize and node drawer have no test) | S (tests) | L |
| Audit of every mutation | Server API audit | Lens Enterprise | Local JSONL shipped | done | M |
| Detectors: SPOF, deprecations to 1.29, NetworkPolicy matrix and builder, attack paths, RBAC "who can", image signatures | Not documented | Not documented (some community Trivy/Argo/KEDA extensions) | Shipped | done | H |
| Upgrade readiness beyond K8s 1.29 | Not documented | Not documented | Table stops at 1.29 | S | M |
| Opt-in "findings export" (SARIF/JSON/Markdown) | Compliance scans | Lens CSV (Plus) | Shipped for audit events; not per detector page | M | M |

## 2. Debate

Participants: a platform engineer (PE, runs 20 clusters), an on-call SRE (SRE, paged at 3am), a product lead (PL, owns launch and positioning).

Top 5 gaps put on the table (by the matrix): (G1) ephemeral debug container, (G2) auto-update + signed builds, (G3) default-container, (G4) Helm release in the owner chain, (G5) cross-cluster search. Top 3 innovations: (I1) "Explain this pod" built from existing detectors (a deterministic, no-LLM incident card: why not ready, what changed, owner, what else shares the cause), (I2) a change timeline per object joining events, rollout revisions and GitOps sync (Timeline exists; join it), (I3) blast-radius preview before any destructive action (drain, delete, scale to zero, NetworkPolicy apply) using SPOF and PDB data already streamed.

### Round 1: positions

- **SRE:** G3 first. At 3am the pod has a sidecar first in the list and I read the wrong logs; kubectl and Freelens already do the right thing and it is an hour of work. G1 next: distroless images are everywhere and "no shell" is a dead end. I1 is what I want: the answer, not twelve tabs.
- **PE:** G2 first. I cannot roll an unsigned, non-updating desktop app out to a team; everything else is polish. G4 is cheap and fixes a docs claim that is currently untrue. For innovation, I3: I have drained the wrong node. Kubebay already knows PDBs and single replicas.
- **PL:** G2 is the launch blocker, but it is L and not code-only (needs signing keys, a notarisation account). Positioning says "no new detectors" for Now; I1 and I3 reuse existing data so they fit. G5 is demand-gated, skip. I2 is a nice demo but Timeline exists.

### Round 2: each must challenge another

- **PE challenges SRE:** G3 is trivial but it is not a reason anyone picks a tool; do not rank it above work that unblocks adoption. **SRE answers:** the ranking is for what we can ship now with no infrastructure; G2 cannot be done by an agent in a branch at all. Adoption blockers are tracked separately, so the question is what to build next. PE concedes: G3 is the right first implementable item, G2 stays top overall.
- **SRE challenges PE:** I3 blast-radius for drain is already half there (PDB-aware drain via the Eviction API, only a failure path tested). A "preview" that is wrong is worse than none: if the PDB data is a few seconds stale, the preview lies at the moment it matters. **PE answers:** show the data age and refuse to preview from a partial stream; preview is advisory and the Eviction API stays the enforcer. SRE accepts if age is shown.
- **PL challenges SRE:** I1 "Explain this pod" risks reading as an AI feature without AI and overpromising; users will test it on odd failures and it will say nothing. **SRE answers:** scope it to six known causes (image pull, crash loop with last exit code, OOMKilled, unschedulable reason, failed probe, PVC pending), and say "no known cause found" otherwise. PL accepts with that scope, and asks that the card cite the field it read.
- **PE challenges PL:** "skip G5" ignores that the verdict note said Rancher and Aptakube prove the need. **PL answers:** the owner removed Fleet, and a cross-cluster search needs every cluster connected, which is the cost they removed; revisit on demand. PE keeps it as the fourth gap, behind Helm owner chain.
- **Agreed refinement:** G1 (debug container) needs RBAC for `pods/ephemeralcontainers` and leaves a container behind in the pod until it restarts; it must show that and be off the default path.

### Verdict (ranked)

Gaps:
1. **G2 Auto-update and signed/notarised builds** (L; needs keys, outside this branch). Highest value, not implementable here.
2. **G3 `default-container` annotation** (S, no infrastructure). **Implemented in this change.**
3. **G1 Ephemeral debug container in the Terminal tab** (M). Shows a "no shell" dead end today.
4. **G4 Helm release in the owned-by chain** (S/M), plus fixing pods.md line 27 either way.
5. **G5 Cross-cluster search** (M), demand-gated.

Also pending (found while checking): verify the YAML editor cannot apply a masked Secret back to the cluster, and update security.md for the shipped masking (S). Upgrade-readiness table past K8s 1.29 (S).

Innovations:
1. **I3 Blast-radius preview** before drain, delete, scale to zero, NetworkPolicy apply (M; show data age; advisory).
2. **I1 "Explain this pod" card**, six known causes, cites the field it read, otherwise says nothing found (M).
3. **I2 Object change timeline** joining events, rollout revisions and GitOps sync (M).

## 3. What this change did

Implemented G3: the Pod drawer's container picker (Logs and Terminal) now starts on the container named by `kubectl.kubernetes.io/default-container`, falling back to the first. `defaultContainer()` in `web/apps/shell/src/lib/pods.ts`, tested in `lib/__tests__/pods.test.ts` and `pages/__tests__/PodPanel.logs.test.tsx`; docs in `website/src/content/docs/pods.md`; CHANGELOG Unreleased. No new route, so no help.ts entry is needed.

Unverified: all Rancher cells marked (unverified); Freelens v1.10.3 default-container is from the research files (release notes read on 2026-11-12), not re-read today; the debate is a structured exercise by one agent in three roles, not independent agents.
