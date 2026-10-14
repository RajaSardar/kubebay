# Kubebay Backlog Plan: 2026 Q4 → 2027 H1

> **Date:** 2026-10-09 · **Baseline:** v0.6.0
> **Derived from:** [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) (Rancher vs Kubebay vs Lens), cross-checked against [ROADMAP.md](ROADMAP.md), [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md), `TRACKER.md` and the innovation backlog (`.claude/memory/innovation_backlog.md`, cited below as "backlog #N").
> **Status of this file:** a plan, not a commitment. Each item still goes through the usual flow (spec → failing test → smallest slice → ship) when Raja picks it up. Nothing here is permission to build without that.

---

## Thesis

**Stop out-building and start out-shipping.**

Kubebay's free feature set already beats Freelens and matches or beats Lens's free tier in most rows, and its cluster-intelligence layer is unmatched. The constraints that actually bind are:

1. **Trust and distribution.**
   - Unsigned builds, with a README that tells users to strip macOS quarantine.
   - No auto-update.
   - Public performance and installer claims that nothing measures.
   - 0 stars and ~0 downloads.
2. **The AI/MCP row.** Lens (Mar 2026), Headlamp and Rancher Prime (Liz) all ship it; Kubebay's well-designed version (backlog #5) is unbuilt.

So the **Now** horizon adds **no new detectors or pages**. It makes Kubebay installable, trustworthy, provably light and AI-connected, then launches it.

## How to read this

- **IDs** are `KB-NN`, stable once assigned. Items reference existing backlog entries (#N) instead of re-specifying them.
- **Effort:** S ≤ 3 days · M ≈ 1–2 weeks · L ≈ 3–5 weeks · XL > 5 weeks. This assumes one maintainer working with AI assistance, at the pace of the last 7 weeks.
- **Tier:** OSS by default. A **[Team]** tag marks an item that only makes sense with a control plane beyond one laptop, so it is gated on KB-01.
- **Every item carries acceptance criteria.** "Done" means the criteria hold *and* CLAUDE.md's gates passed (tests, build, ship, post-ship smoke check).

---

## Horizon map

```
NOW  (v0.7 → v0.8, ~6 weeks: 2026-10-12 → 2026-11-20)
  KB-01 Business-model ADR ─────────────┐ (gates KB-17, KB-20)
  KB-02 Perf harness + honest claims ───┼──► KB-06 Launch kit
  KB-03 Sign + notarize ──► KB-04 Auto-update ─┘
  KB-05 Provenance + artifact signatures
  KB-07 MCP v1, read-only ──► KB-09, KB-18
  KB-08 Rancher-aware clusters

NEXT (v0.9 → v1.0, ~12 weeks: 2026-11-23 → 2027-02-26)
  KB-09 MCP propose/approve   KB-10 EKS discovery     KB-11 Golden-path E2E
  KB-12 K8s/Helm lib refresh + DRA   KB-13 Declarative extensions
  KB-14 Win/Linux smoke CI    KB-15 Findings export   KB-16 Saved views
  KB-17 Opt-in usage signal   KB-18 BYO-key AI triage

LATER (post-1.0; demand- or decision-gated)
  KB-19 Headless `kubebay scan`   KB-20 [Team] edition   KB-21 Air-gap bundle
  KB-22 ⌘K cross-cluster search   KB-23 WASM plugins
```

---

## NOW: trust, proof, launch, MCP (v0.7 → v0.8)

**Exit criteria for the horizon:**
- v0.8 is signed, notarised and auto-updating.
- Every number in the README and on the website is measured in CI, with methodology and a date.
- MCP v1 is shipped and off by default.
- The launch is published.
- At least two weeks of download data exist.

### KB-01 · Decide the business model (ADR): S
- **Why:** three documents contradict each other.
  - PRD §3: *"No feature paywalls. Donations/sponsorships only"* and *"SaaS: rejected permanently."*
  - Innovation backlog: *"Open-core split (working assumption)"*, with Enterprise candidates.
  - RESEARCH.md §8.4: *"Open core + SaaS control plane."*

  Users read ambiguity as a bait-and-switch risk, which is the exact wound Lens carries (analysis §3.4).
- **Scope:** `docs/adr/0001-business-model-and-licence.md`. It records:
  - (a) what stays free forever;
  - (b) whether a paid team edition may ever exist, and its shape;
  - (c) SaaS yes or no;
  - (d) the licence (MIT vs AGPL, RESEARCH §10.3);
  - (e) sponsorship channels.
- **Recommendation (from the analysis):**
  - The MIT core stays free forever, including every single-user feature that has shipped or is planned.
  - The only permissible paid surface is a **self-hosted, licence-keyed team edition** (KB-20), never SaaS.
  - Stay on MIT: the comparable projects are MIT/Apache, and AGPL deters corporate adoption of a client tool for no gain when no SaaS is planned.
  - Sponsorship: `.github/FUNDING.yml` already points at GitHub Sponsors. Confirm the Sponsors profile is live and link it from the README and website.
- **Acceptance:**
  - The ADR is merged.
  - PRD §3, the innovation backlog's "Open-core split" and RESEARCH §8.4 are edited to point at the ADR instead of contradicting it.
- **Owner:** Raja (a decision, not code).

### KB-02 · Performance harness and honest public claims: M
- **Status: step 5 shipped** (2026-10-13).
  - **Comparison data:** the website's comparison table is `website/src/data/comparison.ts`. Every cell has a `source` (URL and date checked), and `comparison.test.ts` fails on a cell without one. It runs in the new `website (astro)` CI job and before each deploy.
  - **Rows removed:** memory, cold start and installer size, until steps 1–3 measure every tool. Other rows that couldn't be sourced for every tool (telemetry, in-cluster deploy, streaming, Helm, RBAC, roadmap) are gone too.
  - **Errors fixed:** k9s's license, Headlamp's desktop app, and Lens's price.
  - **Copy:** the README, PRD §6 and the website copy no longer claim CI enforcement or quote unmeasured figures.
  - **Still open:** steps 1–4.
- **Why:** the README says the budgets (≤150 MB RSS, ≤1.5 s cold start, ≤40 MB installer) are "enforced in CI", and they are not: `ci.yml` has no performance job. The v0.6.0 DMG is 52.9 MB and the AppImage 102.4 MB. The website's Lens and Freelens numbers ("8–15 s", "500+ MB") are unmeasured. ROADMAP M0.5 (the performance harness) was never built.
- **Scope:**
  1. A CI job that records the size of every installer `release.yml` produces and fails on growth of more than 10% over the previous release. **Shipped (2026-10-13), as a warning per step 4:** `scripts/installer-sizes.mjs` in the release job, with `installer-sizes.json` attached to each release.
  2. An engine idle-RSS and watch-load benchmark against kind with generated workloads (1k and 10k pods, metadata mode), as a Go benchmark or a test binary that emits JSON.
  3. Cold start to first interactive frame for the web shell (headless Chromium), plus a manual, scripted macOS desktop measurement recorded per release.
  4. Budgets begin as **warnings** and flip to failures once there are three stable runs.
  5. Rewrite the README and `website/src/components/Comparison.astro` to the measured numbers, with the date and a link to the methodology. Competitors' cells are either measured with the same script or removed. Fix the Lens price cell: Personal is free under $10M revenue or funding.
- **Acceptance:**
  - A performance artifact is attached to each CI run.
  - No public number lacks a source.
  - Test: the website comparison data is a typed module with a `source` field per competitor cell, and a unit test fails if any cell lacks one.

### KB-03 · Developer ID signing and notarization (macOS): S (+ $99/yr)
- **Why:** `tauri.conf.json` has `signingIdentity: "-"` (ad-hoc), and the README tells users to run `xattr -dr com.apple.quarantine`. A tool that holds production kubeconfigs must not teach people to bypass Gatekeeper (analysis §4.3).
- **Scope:**
  - Apple Developer ID certificate and notarization secrets in the repo, wired into the existing conditional steps in `release.yml`.
  - Remove the quarantine instructions from the README and `docs/INSTALL.md`.
  - Windows Authenticode is a follow-up, done when Windows leaves "preview" (KB-14).
- **Acceptance:**
  - `spctl -a -vv Kubebay.app` reports "accepted, source=Notarized Developer ID" on a clean Mac.
  - Homebrew cask installs without a quarantine workaround.

### KB-04 · Auto-update: M (depends on KB-03)
- **Why:** Lens auto-updates. Kubebay users stay on whatever they downloaded, security fixes included. `Cargo.toml` has no `tauri-plugin-updater`, and `TAURI_SIGNING_PRIVATE_KEY` is empty in `release.yml`.
- **Scope:**
  - `tauri-plugin-updater` with a signed `latest.json` on GitHub Releases.
  - A check on launch plus every 24 h; a non-modal "Update ready" banner using `@kubebay/ui`'s `InlineBanner`.
  - Never restart while an exec, port-forward or apply is in flight.
  - A Settings toggle to turn checks off (documented as the only network call Kubebay makes on its own, honouring principle #1).
  - Homebrew users are told to use `brew upgrade` instead.
- **Acceptance:**
  - v0.8.0 updates itself to v0.8.1 in a manual test on macOS.
  - A tampered manifest is rejected (unit test on the signature check).
  - The update check sends no identifiers (test asserting the request has no query string or custom headers).

### KB-05 · Artifact signatures and build provenance: S
- **Status: built, awaiting the v0.8 release to meet acceptance.**
  - `publish.yml` signs the pushed image by digest (cosign v2.6 keyless; `.sig` format, which #45's check verifies) and attests it (`actions/attest-build-provenance`, pushed to the registry).
  - `release.yml` attests every asset and writes `<asset>.cosign.bundle` for each with `cosign sign-blob`.
  - "Verify your download" is in `docs/INSTALL.md`, and the `cosign verify` command is in `charts/kubebay/README.md`.
  - `cosign verify-blob` and `gh attestation verify` on v0.8 assets can only be checked once it's tagged.
- **Why:** Rancher Prime's paid value is assurance (signed images, SBOMs, a trusted registry). Kubebay already ships SBOMs. Signatures and provenance cost little, and they match Kubebay's own signed-image checks (backlog #32, #45).
- **Scope:**
  - Keyless cosign signing of every release asset and of the `ghcr.io/rajasardar/kubebay` image.
  - GitHub artifact attestations (SLSA provenance).
  - A "Verify your download" section in `docs/INSTALL.md`.
  - The Helm chart README shows the `cosign verify` command for the image.
- **Acceptance:**
  - `cosign verify-blob` and `gh attestation verify` succeed on v0.8 assets.
  - Kubebay's own image-signature check (#45) shows the Kubebay in-cluster image as signed.

### KB-06 · Launch kit: M (depends on KB-02, KB-03; ideally KB-04)
- **Why:** 0 stars. `docs/reddit-launch-post.md` and `docs/cncf-landscape-submission.md` are drafted and unpublished. The analysis's positioning is "cluster-intelligence IDE", with "free, local, no account" as the reason to believe and "the best client for Rancher-managed clusters" as a channel (§3.6).
- **Scope:**
  - Refresh and publish the r/kubernetes post. Open the CNCF Landscape PR. Post a Show HN.
  - A 60-second demo video plus GIFs on the website: SPOF radar, NetworkPolicy reachability, attack paths, waste.
  - Guides: "Coming from Lens", "Coming from Freelens", "Kubebay with Rancher-managed clusters" (with KB-08).
  - Enable GitHub Discussions (currently disabled). Add issue templates and a public GitHub Project for this backlog.
- **Acceptance:**
  - All of the above are live.
  - **Evaluation targets 30 days after launch** (targets to learn from, not promises): ≥500 stars, ≥50 weekly downloads, ≥10 issues opened by people other than the maintainer.
  - If the targets are missed, run a retro on positioning before starting more Next-horizon feature work.

### KB-07 · MCP server v1, read-only: M (2–3 weeks)
- **Status: shipped** in #138 (server and stdio bridge) and #139 (Settings card, client configs, sidebar chip).
- **Why:** MCP is now a comparison-table row. Lens shipped it built in (Mar 2026), Headlamp ships an AI assistant over MCP, and Rancher Prime ships Liz over MCP servers (analysis §4.6, §7 point 3).
- **Scope:** **implement backlog #5 exactly as designed.**
  - Streamable HTTP on `/mcp` inside the `requireToken` group, plus a thin stdio bridge (`engine/cmd/kubebay-mcp`) for Claude Desktop.
  - A separate, rotatable MCP token and an `Origin` check.
  - Seven read-only tools: `list_clusters`, `list_resources`, `describe_resource`, `get_logs`, `list_events`, `get_manifest`, `get_cluster_health`.
  - Secrets excluded and env values redacted.
  - `cluster` is required on every tool.
  - Default-deny `mcp` settings block.
  - Every call audited (`Source`, `Client`, `SessionID` on `audit.Entry`).
  - A header chip, a tool-call log and a kill switch in the shell.
  - No headless mode.
- **Acceptance:**
  - Integration tests against kind for each tool.
  - A test proving a Secret's data never appears in any tool output.
  - A test proving a cluster not on the allow-list is refused.
  - A manual check from Claude Code and Cursor.
  - Docs page "Kubebay as your AI agent's safe window into Kubernetes".

### KB-08 · Rancher-aware cluster detection: S
- **Status: shipped** (2026-10-13).
  - `lib/rancher.ts`: a server path `/k8s/clusters/<id>` (https) gives the "Rancher" badge and an "Open in Rancher" row action to `<origin>/dashboard/c/<id>/explorer`. ACE contexts aren't labelled.
  - The `rancher-desktop` context gives "Rancher Desktop".
  - The namespace filter groups by `field.cattle.io/projectId` (annotation, else label) when the cluster has projects.
- **Why:** the analysis says complement Rancher rather than fight it, and the cheapest proof of that is recognising Rancher. The engine already sends each cluster's `server` URL to the shell (`clusters.Cluster.Server`, JSON `server`), so this is frontend work only.
- **Scope:**
  - `lib/clusterDistro.ts` detects:
    - a Rancher-proxied context (server path matches `/k8s/clusters/<id>`) → "Rancher" badge;
    - the `rancher-desktop` context → "Rancher Desktop" badge.
  - Namespaces carrying `field.cattle.io/projectId` can be grouped by Rancher Project in the namespace filter.
  - A "Open in Rancher" row action builds the Rancher UI URL from the server host and cluster ID.
  - Never handle Rancher API tokens: the kubeconfig is the only credential.
- **Acceptance:**
  - Unit tests for each detection pattern, including Authorized Cluster Endpoint contexts (direct server URL), which must *not* be mislabelled.
  - Project grouping covered by a component test.

---

## NEXT: close the comparison gaps (v0.9 → v1.0)

**Exit criteria for the horizon (= v1.0):**
- The golden-path E2E passes in CI.
- Windows and Linux are either smoke-tested or labelled preview.
- EKS discovery and extensions v0 have shipped.
- The Kubernetes libraries are current.
- A first external contributor's feature PR is merged (ROADMAP Phase 2 criterion).

### KB-09 · MCP phase 2: propose and human-approve: M
- **Status: shipped** in #142. There is no apply tool: approval is only in the Kubebay window, which applies exactly the reviewed diff, pinned to a fresh resourceVersion.
- **What:** backlog #5 phase 2.
  - `propose_change` runs the existing dry-run and returns a diff plus a `proposalId` with a 5-minute TTL.
  - The proposal is pushed to the UI over `/ws` and shown in the `ActionsBar` confirm language.
  - The model polls `get_proposal_status`.
  - **There is no `apply_proposal` tool, ever.**
- **Acceptance:**
  - Unanswered proposals expire and are audited.
  - Approval happens only through the UI's typed-confirm path.
  - A test proves no MCP route can mutate.

### KB-10 · EKS cluster discovery and one-click import: M (~2 weeks)
- **Status: shipped**: EKS in #136, GKE in #141, AKS (Entra ID clusters only, via kubelogin) in #148.
- **What:** backlog #14 as scoped (Phases 0–3).
  - Shell out to the user's own `aws` CLI.
  - Scans run only when the user presses "Scan AWS".
  - Configurable regions.
  - Import writes `~/.kubebay/discovered/*.yaml` (mode 0600) and appends it through the existing `extraKubeconfigs` path. **Never write to the user's `~/.kube/config`.**
- **Follow-ups:** AKS (Lens added it in Jan 2026), then GKE, each as its own S/M item once EKS lands.
- **Positioning:** a paid feature in Lens, free here.

### KB-11 · Golden-path E2E against kind: M
- **Status: shipped** (2026-10-14). The `e2e (kind)` CI job runs `e2e/tests/golden-path.spec.ts` in Chromium against the engine-served build and a kind cluster (Kubernetes 1.34), on every PR and on main. It covers: token → cluster list → Pods → logs streaming → exec round-trip (`kb-$((6*7))` → `kb-42`) → port-forward page reachable → YAML edit, Dry-run diff, Apply, checked with `kubectl`. It also fails on any uncaught page error. No retries; the flake budget and how to run it locally are in `docs/E2E.md`.
  - Still open: making the check required needs a repository admin.
- **Why:** this is a ROADMAP Phase 1 exit criterion and was never met. Today's CI is unit and integration tests only.
- **Scope:**
  - Playwright against the web build served by the engine, on a kind cluster in CI.
  - The flow: connect → open Pods → logs stream → exec echo round-trip → port-forward reachable → edit YAML with dry-run diff → apply.
  - Run on every PR. Keep it under 6 minutes.
- **Acceptance:** the job is required in branch protection, and a flake budget is tracked.

### KB-12 · Kubernetes library refresh and DRA: M
- **Status: partly shipped** (2026-10-13).
  - **Library bump:** `k8s.io/*` went to v0.34.10 and Helm to v3.19.5. These are the newest versions on Go 1.24; Kubernetes 1.35+ libraries and Helm 3.20+ need Go 1.25 or 1.26. That bump is a separate decision, because `make build` uses `GOTOOLCHAIN=local`.
  - **CI:** the integration suite runs on kind with Kubernetes 1.29 (pinned), 1.34 and 1.37.
  - **DRA:** the `resource.k8s.io/v1` tables are in DEFS with their own columns, under a "Devices (DRA)" sidebar group. The Pod drawer links the pod's ResourceClaims.
  - **Checked:** `TestLiveDRAObjectsStream` streams DeviceClasses, ResourceSlices and ResourceClaims on 1.34+ and skips below. The tables were checked against an envtest 1.34 API server seeded with allocated claims.
  - **Still open:** Helm 4 evaluation, the Go 1.25/1.26 bump for the newest libraries, and a run with the DRA example driver.
- **Why:** `client-go v0.31.4` and `helm v3.16.4`, while Kubernetes is at 1.36 (Rancher 2.15.1 supports it). Lens 2026.9 shipped DRA devices in its navigator, and Kubebay already has GPU accounting (backlog #40).
- **Scope:**
  - Bump `k8s.io/*` to the current minor and Helm to the latest 3.x. Evaluate Helm 4 separately.
  - Run the kind integration suite on three Kubernetes versions (ROADMAP risk register).
  - Add `resource.k8s.io` kinds (DeviceClass, ResourceClaim, ResourceClaimTemplate, ResourceSlice) to DEFS, and link ResourceClaims from the Pod drawer.
- **Acceptance:**
  - Green on the oldest and newest supported Kubernetes versions.
  - The DRA tables render against a kind cluster with the DRA example driver.

### KB-13 · Declarative extensions v0 (actions and columns): M
- **Status: shipped** (2026-10-13). `engine/internal/extensions` parses and validates `~/.kubebay/extensions.yaml` per entry, and `GET /api/extensions` serves it, read on every request.
  - The shell fills in the templates (`lib/extensions.ts`). Columns and actions appear on the `/r/:kind` tables and on Pods.
  - URL values are percent-encoded, and the host must be literal. Command values are single-quoted for POSIX shells and fish, verified against bash, dash, zsh (with `RC_QUOTES` too) and fish.
  - Commands are pasted into the local shell, bracketed when the shell asks for it, and never with Enter. They're offered only where the local shell runs sh, bash, zsh, dash, ksh or fish.
  - The three docs examples (Grafana, stern, the Rancher fallback) are loaded by a Go test.
- **Why:** Rancher (UI extensions), Lens (extensions API), Headlamp (plugins + marketplace) and k9s (`plugins.yaml`) are all extensible. Kubebay is not. The planned WASM system (ROADMAP Phase 3) is XL. k9s shows that a declarative file captures most of the value.
- **Scope:**
  - `~/.kubebay/extensions.yaml`, written by the user only, never downloaded. It defines:
    - **custom columns:** JSONPath expressions per GVR;
    - **row actions:** either an "open URL" template, or a "run in local shell" command template, executed in the existing local shell terminal (backlog #10) so the user sees and controls it.
  - Templates escape arguments. Nothing executes inside the engine.
  - The local shell is desktop-only (`-tags localshell`, `--local-shell`, loopback, no OIDC), so command actions are hidden in web and in-cluster modes.
- **Acceptance:**
  - Schema validation with readable errors in Settings.
  - Escaping tests against injection in resource names and labels.
  - Three example extensions in the docs (a Grafana link, `stern` on a workload, an "open in Rancher" fallback).

### KB-14 · Windows and Linux desktop confidence: M
- **Why:** `release.yml` publishes `.exe`, `.deb` and `.AppImage` builds, but TRACKER.md defers parity and nothing tests them. Untested installers do more harm than no installers (analysis §7 point 5).
- **Scope:**
  - A CI smoke job on `windows-latest` and `ubuntu-22.04`: build, launch headless, wait for the engine health endpoint and the webview's first paint, then exit cleanly.
  - Until it is green, the README and website label both platforms **Preview**.
- **Acceptance:** the job is green, and the label is removed only after a manual pass on each OS.

### KB-15 · Findings export: S–M
- **Status: shipped** (2026-10-13). An "Export report" action on the RBAC page saves SARIF 2.1.0, JSON or Markdown, built by `lib/findingsReport.ts` from the existing detectors' findings with their CIS and ATT&CK control IDs. It covers attack paths, RBAC (non-system, as the card shows), upgrade readiness, SPOF, NetworkPolicy coverage, secrets in env vars, default-SA token automount, and namespaces without image-signature enforcement.
  - Golden files cover each format, and the SARIF is validated against the OASIS 2.1.0 schema (ajv, draft-04).
  - The report records the cluster, the time and the Kubebay version, which comes from a new token-protected `GET /api/version`.
- **Why:** the detectors are Kubebay's most differentiated asset, and today they live only on screen. Teams and auditors need to share them without a server.
- **Scope:**
  - One "Export report" action that writes JSON, Markdown and **SARIF**. It covers SPOF, NetworkPolicy gaps, RBAC findings, secret exposure, SA-token over-mount, upgrade readiness, signed images and attack paths, all with framework control IDs (backlog #34).
  - It reuses the existing TypeScript detectors in `web/apps/shell/src/lib/`. No engine changes.
- **Acceptance:**
  - A golden-file test per format.
  - The SARIF passes a schema check.
  - The export records cluster, time and Kubebay version.

### KB-16 · Saved views (workspaces): M
- **Status: shipped** (2026-10-13), for the `/r/:kind` resource tables.
  - `lib/savedViews.ts` is a zustand store persisted under `kb.views`. Applying a view writes the table's own `kb.sort.r/<kind>` and `kb.cols.r/<kind>` prefs, sets the namespace selection and the active cluster, and opens `/r/<kind>?q=…&view=<id>`.
  - Views open from the `/view/:id` route, which the sidebar and ⌘K link to.
  - Export and import use a validated `kubebay.savedViews` v1 file.
  - The Pods page (`/workloads`) isn't covered yet.
- **Why:** RESEARCH §8.3 says the moat is workflow lock-in, and the way to build it without a server is local, portable state.
- **Scope:**
  - A named view = cluster + namespaces + kind + filter (`key:value` syntax) + columns + sort.
  - Shown in the sidebar and in ⌘K.
  - Export and import as a JSON file, so teams can share views through git.
- **Acceptance:** round-trip tests for export and import; views survive restart and kubeconfig reload.

### KB-17 · Opt-in usage signal: S–M (gated on KB-01)
- **Why:** PRD §8's success metrics ("weekly active installs, opt-in only") cannot be measured today.
- **Step 1, which costs nothing in the app:**
  - Track GitHub release download counts and Homebrew analytics.
  - A monthly `scripts/` report.
- **Step 2, only if step 1 is not enough:**
  - A first-run consent dialog, **off by default**.
  - A documented payload: version, OS, random install ID, daily page-visit counts. No cluster data, ever.
  - An open-source collector.
  - A "send now / view payload" button in Settings.
- **Acceptance (step 2):** a test asserts that nothing is sent without consent, and the payload schema is published in `docs/SECURITY.md`.

### KB-18 · BYO-key AI failure triage: M–L (depends on KB-07)
- **Status: shipped**: consent, evidence and the review pane in #140; Send with evidence-cited, structured findings in #147 (Anthropic Go SDK, any Messages-API endpoint). A local Ollama isn't supported.
- **What:** the deferred half of backlog #13.
  - The engine-side LLM call uses a user-supplied key or a local Ollama, with a configurable base URL.
  - A per-cluster allow-list.
  - A "review what will be sent" pane.
  - It shares the redaction and evidence assembler with MCP.
  - Every claim links to the evidence it rests on. Suggested actions never become executable buttons.
- **Positioning:** Lens Prism is Premium. Kubebay's is free with your own key.

---

## LATER: decision- or demand-gated (post-1.0)

### KB-19 · Headless `kubebay scan`: L (gated on KB-15 adoption)
- **What:** port the highest-value detectors from TypeScript to Go in the engine and expose `kubebay scan --cluster X --format sarif|json` for CI and cron jobs.
- **Why later:** most detectors live in `web/apps/shell/src/lib/` (for example `spof.ts`, `netpolEval.ts`, `attackPaths.ts`), so this is a port, not a wrapper. KB-15 proves demand first.

### KB-20 · [Team] Self-hosted team edition: L–XL (gated on KB-01 and ≥3 organisations asking)
- **What:** on top of the in-cluster chart:
  - SSO group → feature policy (for example "group X: no exec, no delete");
  - central audit export (OTLP, syslog, S3);
  - shared saved views;
  - a multi-cluster hub mode.
- **Guardrail:** this is the only place a licence key may ever appear, and only for team-only capabilities. Never gate a single-user feature (ADR KB-01).
- **Watch-out:** hub mode drifts toward Rancher's territory. Keep it read-mostly, with no provisioning.

### KB-21 · Air-gapped install bundle: S–M
- **Status: shipped** (2026-10-13).
  - `scripts/airgap-bundle.mjs` and a release job build `kubebay-airgap-<version>.tar.gz`: the pinned chart, a multi-arch OCI archive and per-arch docker archives, `docs/AIRGAP.md`, and `SHA256SUMS` with its cosign bundle.
  - Unit-tested, and run end to end locally with skopeo and helm 3.19.5 on a test image: `sha256sum -c` passes, the chart renders the pinned tag, and the docker archive carries the image name.
  - The release job first runs on the next tag.
- **What:** a chart plus an image tarball, offline docs, and a checksum and signature manifest.
- **Why:** Lens sells air-gapped activation in Enterprise ($50/seat). Kubebay already works offline by design and only needs packaging. It stays OSS unless the ADR says otherwise.

### KB-22 · ⌘K cross-cluster search: M (demand-gated)
- **What:** "where is X?" and "what is crashlooping?" across *connected* clusters, as an on-demand query from the palette.
- **Not this:** a streaming dashboard. That respects backlog #52, the removal of the Fleet page.
- **UX reference:** Aptakube.
- **Build only if:** issues or discussions show demand after launch.

### KB-23 · WASM plugin system: XL (gated on KB-13 usage)
- **What:** ROADMAP Phase 3 (wazero, capability grants, signed index, UI slots).
- **Build only if:** declarative extensions hit real limits that users report.

---

## Explicitly not doing (reaffirmed by the analysis)

| Not doing | Why |
|---|---|
| Cluster provisioning or lifecycle (RKE2, K3s, CAPI, hosted-cluster creation) | Rancher's decade-long moat; PRD non-goal |
| Hosted SaaS or mandatory accounts | The wound Lens carries; PRD non-goal; ADR KB-01 confirms |
| A GitOps engine (a Fleet or Argo replacement) | Integrate, don't replace (PRD) |
| Multi-tenancy "Projects" layer | Use Kubernetes RBAC; show Rancher Projects instead (KB-08) |
| AI that applies changes directly | Propose-and-approve only (KB-09, backlog #5) |
| Bundled kubectl | Backlog #8: decided no |
| Reviving the Fleet page | Backlog #52: owner decision; KB-22 is the demand-gated alternative |
| New detectors or pages in the Now horizon | Analysis §7 point 2: package and distribute what exists first |

---

## Capacity check

| Horizon | Items | Effort sum (midpoint) | Fits? |
|---|---|---|---|
| Now | KB-01…08 | 3×S + 4×M + ADR ≈ 5–6 weeks | ✅ ~6-week window |
| Next | KB-09…18 | 1×S–M + 7×M + 1×M–L + 1×S–M ≈ 11–13 weeks | ⚠️ tight. If it slips, cut KB-16, then KB-17 step 2, then KB-18 |
| Later | KB-19…23 | Gated; not scheduled | — |

## Metrics to review each release

- **Adoption:** stars, release downloads per asset, Homebrew installs, issues and PRs from people other than the maintainer.
- **Trust:** notarized ✅ / ❌, signed assets ✅ / ❌, auto-update adoption (share of downloads on the latest version).
- **Proof:** installer sizes and idle RSS against the budgets (KB-02 artifact).
- **Quality:** E2E pass rate and flake rate (KB-11); time from a reported regression to its fix.
