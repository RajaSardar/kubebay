# Freelens vs Kubebay inventory F41-F78

Checked 2026-11-12. Freelens core = freelensapp/freelens, latest v2.0.0 (28 Oct 2026).

## What was checked (basis for every NOT-DOCUMENTED)

- GitHub Releases API: all 30 releases, v0.1.1 through v2.0.0, full bodies and asset lists, grepped for helm, port-forward, node shell, prometheus, network policy, argo, flux, rbac, vulnerab, trivy, topology, keda, karpenter, mcp, audit, oidc, telemetry, checksum, sbom, cosign, attest, signed, air-gap, docker, web.
- Main README (raw), SECURITY.md, docs/ folder (extensions/api.md, binaries.md, migrating-from-v1.md, styling.md only), wiki Home (Users: Extensions, Donations; Developers), freelensapp.github.io (download hub, no feature list), org repo `docs` (extension API docs only).
- Release workflow and release-scan workflow in .github/workflows (grep for attest, cosign, sbom, sign, notarize).
- Source code, shallow clone of main on 2026-11-12 (helm-releases, port-forward, node shell, network-policies, user-management, workloads-overview, standalone-terminal, preferences, version check).
- All 30 org repos (GitHub API) incl. freelens-fluxcd, gpu, for-claude, sveltos, kamaji, karpenter, keda, resource-map, ai, agentbridge, velero, marketplace (extensions.json, 11 entries) and the topic freelens-extension (4 repos) and a text search for "freelens extension" (144 repos, top 50 scanned).
- Issue tracker: title searches for network policy (0), argo (0), trivy (1, supply chain unrelated), vulnerab (0), cost (0 relevant), rbac (2), topology (0), keda (0), karpenter (1), mcp (1, test tooling), helm chart (5), port forward (4), node shell (8), telemetry (1), audit/OIDC/browser/docker/web via title+body (nothing relevant except #1851). Search is GitHub title/body search, not exhaustive of discussions.
- I did not read GitHub Discussions beyond one link, Discord, or the live freelens.app site beyond the home page (WebFetch).

## Table

ID | status | where | evidence

F41 Port-forward manager | HAS (partial: persistent list, random port; not a tunnel supervisor) | core app, Network > Port Forwards | Source: packages/core/src/renderer/port-forward/port-forward-store/port-forward-store.injectable.ts uses persistent storage `createStorage("port_forwards")`; port-forward-dialog.tsx has local-port placeholder "Random". Release v1.6.2: "Cluster search and port forwards are available from the command palette." v1.3.1: "Listen address can be set for port-forward command." Issue #1853 (open) asks for a port-forward context-menu entry. Whether tunnels restart automatically after app restart not verified: UNCLEAR for that detail.

F42 Local terminal bound to a cluster context | HAS | core app | v2.0.0 notes: "Open a terminal outside a cluster session: a standalone terminal page with its own tabs ... uses your own shell environment, KUBECONFIG and kubectl/helm". Cluster terminals (dock) existed since OpenLens. https://github.com/freelensapp/freelens/releases/tag/v2.0.0

F43 Helm releases streamed live | HAS-DIFFERENT | core app, Helm > Releases | Releases list is fetched by running `helm ls` (not a stream) and re-fetched when the cluster's Helm release Secrets change (store subscription). Source: renderer/components/helm-releases/release-secrets.injectable.ts (`subscribeStores([secretStore])`, filters `helm.sh/release`). Open issue #2972 (2026-11-09): "Every read spawns the helm binary (helm ls --all-namespaces ...)"; PR #2973 would read the Kubernetes API instead. Slow on large clusters per #2972.

F44 Release Overview listing created objects, grouped, live status, hooks, notes | HAS-DIFFERENT | core app, release drawer | Drawer shows Status, Values (toggle "User-supplied values only"), Notes, and Resources grouped by kind as name/namespace links. Source: release-details-content.tsx (`<DrawerTitle>Notes`, `<DrawerTitle>Resources`, ResourceGroup table has only Name and Namespace columns). No per-resource live status column and no hooks section found in the component (grep for "hook" in helm-releases returned nothing).

F45 History, values, manifest, upgrade with edited values, rollback, uninstall | HAS (history is only inside the rollback dialog; manifest used internally) | core app | Source: main/helm has `rollback-helm-release`, `get-helm-release-history` (`helm history --output json`), `get-helm-release-values`, `delete-helm-release`, install/upgrade; release-menu.tsx offers Upgrade (opens upgrade-chart dock tab), Rollback dialog with revision picker, Delete. v1.8.0: "Helm chart installation with edited values" fixed. No separate user-visible "manifest" viewer found (manifest is fetched to list Resources).

F46 Install charts from user's repos | HAS | core app, Helm > Charts; repos in Preferences | v1.3.1: "removed default Helm repository" and "Helm hub repository refresh"; source features/helm-charts has add-custom-helm-repository, installing-chart tests; issues #2867/#2868 (closed): "Refresh Helm charts after a Helm repository is added or removed". v1.10.0: fixed "Bad Request" errors when installing Helm charts.

F47 Argo CD view (sync, health, drift, Hard Sync) | HAS-EXTENSION (community, NOT in freelensapp org) | Sebastian-Prokesch/freelens-argocd-extension (MIT, pushed 2026-11-06); jhajali/freelens-argocd-extension (MIT, 2026-03-30); not in the official marketplace list | README of Sebastian-Prokesch ext: "dedicated Argo section ... for ArgoCD and Argo Rollouts"; jhajali README: "Context Menu Actions - Sync and Hard Refresh actions for Applications". Core Freelens: 0 issues/releases mention Argo. Whether they need an Argo login not checked (they read CRDs via the kube API per README description; not verified).

F48 Flux view (Kustomizations, HelmReleases Ready, what each manages, drift) | HAS-EXTENSION (official, freelensapp/freelens-fluxcd-extension) | extension, needs Freelens >= 2.0.0 (5.x for 1.x) | https://github.com/freelensapp/freelens-fluxcd-extension : "dashboard, cluster pages, list views, and detail panels for the FluxCD custom resources"; "Resource menus allow reconciling, suspending, and resuming". "Drift Flux already corrected" and "what each manages" not shown in README: UNCLEAR for those two details.

F49 Workloads Overview: what's broken and why | HAS-DIFFERENT | core app, Workloads > Overview | Source packages/core/src/renderer/components/workloads-overview has status counts per workload kind and events; no root-cause, node pressure, Service health or DNS checks found in the folder. Resource Map extension adds a "Resources" panel to Workloads > Overview.

F50 SPOF Radar | NOT-DOCUMENTED | n/a | Searched README, all 30 release notes, org repos, marketplace, issue titles (no "SPOF"/"single replica"/PDB analysis hits). Core has PodDisruptionBudget list views (renderer/components/config-pod-disruption-budgets) but no analysis.

F51 Cost/Waste | HAS-EXTENSION for GPU only (official); NOT-DOCUMENTED for general cost | freelensapp/freelens-gpu-extension | GPU README: sidebar "GPU: Pods, Namespaces, Inference, GPUs, Idle & waste, Allocation, Pending, Exporters". Core has cluster/node/pod CPU/memory Prometheus charts (v1.10.0 "Time range selector for metrics charts") but no efficiency score, idle capacity, p95 usage-vs-requests view found. Issue search "cost": nothing relevant.

F52 Consolidation simulation, spot risk, headroom forecast, anomaly detection | NOT-DOCUMENTED | n/a | Same search set as F50. Karpenter extension (official) shows NodePools/NodeClaims but states it "writes nothing" and has no simulation in README intro.

F53 Right-sizing recommendations | HAS-DIFFERENT (manual resize only) | core app v1.9.0 | v1.9.0: "Pods can be resized by patching resources or container resources." VPA objects have list views (renderer/components/config-vertical-pod-autoscalers). No recommendation engine, p95, or GitOps-revert warning found.

F54 Upgrade Readiness (deprecated APIs) | NOT-DOCUMENTED | n/a | Searched README, release notes, repos, issue titles. Release notes only record Freelens's own Kubernetes version support (e.g. v1.0.0 "Full Kubernetes 1.32 compatibility").

F55 NetworkPolicy connectivity matrix + list | HAS-DIFFERENT (list and per-policy details only) | core app, Network > Network Policies | Source renderer/components/network-policies: list columns incl. "Policy Types", details drawer with Ingress and Egress rules. No matrix. Issue title search "network policy": 0 results.

F56 NetworkPolicy coverage gaps + "can A reach B" evaluator | NOT-DOCUMENTED | n/a | Same as F55; no extension in org, marketplace or topic search.

F57 NetworkPolicy builder + live connectivity test | NOT-DOCUMENTED | n/a | Same as F55. Core can create/edit via YAML (generic), no builder found.

F58 Topology graph | HAS-EXTENSION (official, freelensapp/freelens-resource-map-extension) | extension, Freelens >= 2.0.0 | README: "draws the resources of a Kubernetes cluster, and the links between them, as a live graph: the pods, the workloads ... Services ... Ingresses ... Helm releases". Includes Resource Map page and per-object maps. Does not show ReplicaSets explicitly in the quote; ReplicaSets not confirmed.

F59 Vulnerabilities (Trivy-Operator) | NOT-DOCUMENTED | n/a | README, all releases, org repos, marketplace, issue titles (trivy: only #1711 about Trivy supply chain attack in CI). Lead: kubescape/lens-extension (Lens extension, repo listed 144-search; its README now 404, so compatibility unknown) - UNCLEAR, do not cite.

F60 RBAC "Who can" explorer | NOT-DOCUMENTED | n/a | Core has Roles, RoleBindings, ClusterRoles, ClusterRoleBindings, ServiceAccounts views (renderer/components/user-management); v1.6.0 "enhanced role binding views"; issue #1125 columns with role name and ref types. No reverse "who can" lookup found.

F61 RBAC findings | NOT-DOCUMENTED | n/a | Same as F60.

F62 "My access" | NOT-DOCUMENTED (as a page) | n/a | Source has internal can-i (common/cluster/create-can-i.injectable.ts, SelfSubjectAccessReview) used to decide what to show, and v2.0.0 adds cluster settings to "skip the namespace authorization and metrics endpoint checks". No user-facing "what can I do" page found.

F63 Attack paths | NOT-DOCUMENTED | n/a | Same search set as F59-F61.

F64 Workload security checks | NOT-DOCUMENTED | n/a | Same. Pod details do mask/reveal secret values (v2.0.0 fix: "A secret value revealed in the pod details no longer stays revealed") but no findings.

F65 Image-signature coverage checks | NOT-DOCUMENTED | n/a | No hits for kyverno/sigstore/ratify/connaisseur in releases, repos or issue titles beyond v1.10.0 note that CRD-heavy clusters (Kyverno etc.) crashed (fixed).

F66 Audit-log security events, findings report, compliance IDs | NOT-DOCUMENTED | n/a | Open issue #1851 "Audit/command log for learner" (2026-05-07) asks for a command log, implying none exists. No security report feature found.

F67 KEDA page | HAS-EXTENSION (official org repo is a placeholder; working code is community nidiodolfini/freelens-keda-extension) | freelensapp/freelens-keda-extension ("This repository is being set up"), code at github.com/nidiodolfini/freelens-keda-extension (pushed 2026-11-08) | README: "browse ScaledObjects, ScaledJobs, TriggerAuthentications ... and pause or resume autoscaling from the object menu"; Freelens 2.x. No HPA-conflict detection, wizard, scale-to-zero highlighting or unused-TriggerAuthentication detection stated (it lists which objects use each authentication).

F68 Karpenter page | HAS-EXTENSION (official, freelensapp/freelens-karpenter-extension) | extension for Freelens 2 | README: "Node Claims, Node Pools, Node Overlays ... node classes"; "reads the Karpenter objects ... and writes nothing to it". So no edits with eviction warnings; AWS, Azure, GCP supported. Spot vs on-demand and unschedulable-pods views not confirmed in the part read.

F69 Install a VPA recommender | NOT-DOCUMENTED | n/a | Searched as F53. Core only lists VPA objects.

F70 MCP server (opt-in clusters, approvals) | HAS-DIFFERENT / HAS-EXTENSION (official) | freelens-for-claude-extension, freelens-ai-extension (MCP Agent), freelens-agentbridge-extension, all in freelensapp | Freelens is not documented to be an MCP server. Claude ext: "Read-only tools run automatically; mutating tools always require your approval", modes Read-only / Approve, and opt-in "User MCP servers ... every external tool call requires approval"; needs your own Claude Code install. AI ext README: "We support MCP Agent through a dedicated configuration." https://github.com/freelensapp/freelens-for-claude-extension

F71 Local audit log of changes and AI/MCP calls | NOT-DOCUMENTED | n/a | Open issue #1851 "Audit/command log for learner". Claude ext README mentions a backup in its approval card but no local audit log found in the lines read.

F72 Desktop app for macOS, Windows, Linux | HAS | README | "a standalone application compatible with macOS, Windows, and Linux". macOS 13+ (arm64 and amd64, DMG and PKG), Windows x64 and arm64 (EXE, MSI, portable), Linux amd64 and arm64 (AppImage, DEB, RPM; Flatpak, Snap, APT, AUR). Release v2.0.0 asset list confirms these files.

F73 Standalone engine / Docker image serving web UI | NOT-DOCUMENTED | n/a | Electron desktop app only. README, site, 30 releases (assets are desktop installers, SBOMs, APT index only), org repos (no server/docker repo) and issue search (docker, browser) show no web/server mode. freelens-k8s-proxy is an internal sidecar for the desktop app. Moderate confidence; absence of a web mode is strongly implied by packaging but never stated.

F74 In-cluster Helm chart with OIDC sign-in impersonation | NOT-DOCUMENTED | n/a | Same as F73; no Helm chart in org repos; OIDC mentions only relate to kubeconfig auth plugins (issue #1403, #1219 Entra ID Device Login). Desktop app uses the user's own kubeconfig.

F75 No account, no telemetry, open source | HAS (MIT; no sign-in; telemetry removed, not explicitly promised) | README and source | Licence: "[MIT License](https://opensource.org/licenses/MIT)". No account/sign-in anywhere in README. Issue #234 closed 2025-03-07 "Remove sentry and telemetry setting": "It was inactive code as we do not have sentryDsn defined." No privacy/telemetry statement in README or site. Source: update check calls https://registry.npmjs.org/@freelensapp/core/latest (main/versions/get-latest-version.injectable.ts) for the new-version notice, so there is one outbound call to npm.

F76 Local engine session token; Secret values not loaded into tables | UNCLEAR / HAS-DIFFERENT | n/a | Not applicable architecture (no local engine; internal freelens-k8s-proxy). Secrets: Secret details can reveal values on click (v2.0.0 "A secret value revealed in the pod details no longer stays revealed when switching to another pod"). Whether the Secrets list loads values: not verified. Issue #2399 (open) discusses renderer sandboxing cost: renderer is not sandboxed today (inference from title only).

F77 Release checksums and build-provenance attestation | HAS for checksums; NOT-DOCUMENTED for attestation | GitHub Releases | Every asset has a `.sha256` file (v2.0.0 assets list, e.g. Freelens-2.0.0-macos-arm64.dmg.sha256). SBOMs (SPDX and Syft JSON) since v1.10.1: "Release artifacts now include a Software Bill of Materials (SBOM)". Release workflow grep found no `attest`/`provenance` step for Freelens's own artifacts. v2.0.0 notes say provenance is verified for bundled kubectl/helm/proxy digests, not published for Freelens itself.

F78 Signed cosign bundles for release assets; air-gapped install bundle | HAS-DIFFERENT | releases | Cosign: not used to sign Freelens assets (cosign appears only to verify upstream kubectl in workflows kubectl-checksums-check.yaml). Platform signing instead: Windows signed since v1.10.2 ("Windows binaries are now signed"; earlier 0.1.4 "Signed Windows MSI and EXE"), macOS PKG notarized (release.yaml), APT repo has Release.gpg/InRelease. Air-gapped: v1.10.0 "Custom download mirror URL for kubectl in Preferences -> Kubernetes -> Kubectl, useful for air-gapped environments"; Freelens ships bundled kubectl and helm. No dedicated air-gapped install bundle.

## Other facts for the delivery rows

- Platforms: macOS 13+, Windows 10+, Linux glibc 2.34+; Kubernetes 1.22+.
- Licence: MIT. Fork of OpenLens (v0.1.1 "First release based on last OpenLens version").
- Extensions install by npm name from an in-app Extensions page; official marketplace list (extensions.json): agentbridge, ai, fluxcd, kamaji, resource-map official; jobset, duplicate, version-update, multi-pod-logs, resource-filter, certificate-info community.
- v2.0.0 (28 Oct 2026) is a breaking extension-API release; extensions for 1.x need updating.

## Weakest findings

1. F73/F74 (no web mode, no in-cluster chart): inferred from packaging and missing mentions only; no page states "desktop only". Prefer wording "Freelens ships as a desktop app" not "cannot run in a browser".
2. F41 (port-forward manager): persistent storage found in source, but auto-restart of tunnels and "one list of every tunnel" (Network > Port Forwards page exists) were not exercised.
3. F47/F48 (GitOps): only READMEs of extensions read; drift, "what each manages", and whether Argo needs login not confirmed; Argo extensions are community, not official.
4. F43/F44 (Helm): code read on main, which may be ahead of v2.0.0; PR #2973 (open) would change the listing mechanism. "Live status" and "hooks" absence judged from one component and a grep.
5. F76 and F77 attestation: F76 does not map onto Freelens's architecture, so left UNCLEAR; for F77 the absence of GitHub attestation rests on a grep of release.yaml and release notes, not on inspecting the attestations tab of a release.
