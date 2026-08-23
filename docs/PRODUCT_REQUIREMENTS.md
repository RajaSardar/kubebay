# Kubebay Product Requirements

> Status: living document. Phases map 1:1 to [ROADMAP.md](ROADMAP.md).
> "P0/P1/P2/P3" = phases, not Kubernetes API groups.

---

## 1. Vision

The Kubernetes IDE that power users trust and developers enjoy: **local-first, featherweight,
real-time, and genuinely beautiful** — with the features every competitor left on the table.

## 2. Personas

| Persona | Jobs-to-be-done | Priority features |
|---|---|---|
| **App developer** (daily) | See my deploy status, tail logs, exec in, tweak YAML, port-forward to debug | Live tables, logs, terminal, YAML edit+diff, port-forward manager |
| **SRE / Platform engineer** (hourly) | Multi-cluster overview, RBAC audits, event forensics, Helm ops | Fleet view, topology, timeline, RBAC explorer, Helm manager |
| **On-call responder** (2 a.m.) | What's broken, where, since when — fast, from any device | Command palette, timeline, alerts integration (later), responsive web |

## 3. Non-Goals (permanent)

- ❌ No accounts, no hosted control plane, no SaaS tier.
- ❌ No mandatory telemetry (opt-in, anonymous, documented payload — ever).
- ❌ No cluster provisioning/management (we observe & operate existing clusters; we are not Rancher).
- ❌ Not a CI/CD or GitOps engine — we *integrate* with Flux/ArgoCD, never replace them.
- ❌ No feature paywalls. Donations/sponsorships only.

## 4. Feature Requirements by Phase

### P0 — Foundation
| ID | Requirement |
|---|---|
| F-0.1 | Monorepo scaffold per TECH_STACK §3; CI with lint + perf harness skeleton |
| F-0.2 | Engine: multi-context kubeconfig load (`~/.kube/config`, `$KUBECONFIG`), file-watch reload, health states |
| F-0.3 | Delta-stream protocol v1 (sub/unsub/snapshot/delta/resync) over single WS |
| F-0.4 | SPA shell: routing, layout (sidebar/work-area/status-bar), command palette skeleton |
| F-0.5 | Design system v1: theme tokens + **Dusk/Dark (default)**, **Dawn/Light**, system-follow; typography, spacing, color ramps |
| F-0.6 | Resource tables (virtualized, live): Pods, Deployments, StatefulSets, DaemonSets, Jobs, CronJobs, Nodes, Namespaces |
| F-0.7 | Detail views: summary, metadata, conditions, containers, owner chain, events, raw YAML tab |

### P1 — Daily-Driver Parity ("replace Freelens for daily work")
| ID | Requirement |
|---|---|
| F-1.1 | Log viewer: multi-container select, follow/tail(N), pause/resume, regex filter, severity coloring, JSON/logfmt pretty-print, timestamps toggle, previous-container dump, download, pop-out |
| F-1.2 | Terminal exec (xterm.js), resize propagation, session survives navigation within cluster view |
| F-1.3 | Port-forward manager: create/list/stop, persistent sessions, local-port conflict detection |
| F-1.4 | Quick actions: scale, restart (rollout), delete w/ typed confirm, cordon/drain (node) |
| F-1.5 | YAML editor: schema-aware completion/validation, diff-preview-before-apply (SSA), dry-run default |
| F-1.6 | All core config/network/RBAC resource kinds browsable generically; **any CRD auto-discovered** with table + detail views |
| F-1.7 | Metrics: CPU/mem per pod/node/container via metrics-server; sparklines + sortable columns; Prometheus adapter optional |
| F-1.8 | Events tab per resource + global events view w/ filters |
| F-1.9 | Namespace switcher (single/multi-select), context/cluster switcher, per-cluster connection badges |
| F-1.10 | Command palette full: navigate, act on selection, recent items; keyboard profile incl. Vim-style option |
| F-1.11 | Search: client-side fuzzy across loaded topics; server-side label/field selectors pushed down |
| F-1.12 | Desktop apps packaged + auto-update (Tauri updater) for macOS/Win/Linux |

### P2 — Differentiators
| ID | Requirement |
|---|---|
| F-2.1 | **Topology view**: live graph from ownerReferences + Service/Ingress endpoints; zoom levels (workload → pod → container); status-colored edges; click-through to details |
| F-2.2 | **Event timeline**: unified chronological stream (per namespace/cluster), grouped bursts, filter by kind/reason/object, jump-to-resource |
| F-2.3 | **RBAC explorer**: effective-permissions query (who can do X on Y), RoleBinding graph, "my permissions" panel; UI affordances driven by SSAR cache |
| F-2.4 | **Helm manager**: release list across namespaces, install from repos, upgrade/rollback w/ values+manifest diff preview, history |
| F-2.5 | **Fleet dashboard**: all connected clusters at a glance — node pressure, failing workloads, recent critical events |
| F-2.6 | In-cluster web mode: official Helm chart, OIDC login, user impersonation, responsive-enough for tablets |
| F-2.7 | GitOps awareness: surface Flux/Argo managed-by lineage on resources; link to source repo/PR (read-only) |
| F-2.8 | Audit log (local JSONL) of every mutation performed through Kubebay |

### P3 — Platform & Moat
| ID | Requirement |
|---|---|
| F-3.1 | Plugin system GA: WASM backend modules (wazero, capability grants) + React extension slots (sidebar/detail tabs/columns/actions); signed registry index |
| F-3.2 | Built-in MCP server: read-only tools (get/list/logs/events/analyze), resources, troubleshooting prompts; works with Claude/Cursor/etc. |
| F-3.3 | AI copilot panel: deterministic analyzers (keyless, offline) + opt-in LLM explanation via OpenAI-compatible providers incl. local Ollama; anonymization ON by default; write-actions require explicit per-action approval |
| F-3.4 | Alerts integrations read-only: surface Prometheus Alertmanager / KubeSphere-style alerts inline on resources |
| F-3.5 | Plugin marketplace UX (browse/install/update/remove; offline-friendly) |

### P4 — Reach
| ID | Requirement |
|---|---|
| F-4.1 | Mobile-responsive web polish: read-only dashboards, pod status/log triage on phones |
| F-4.2 | Decision gate: native mobile shells (Tauri 2 iOS/Android targets of same SPA) — build only if F-4.1 usage data justifies it |
| F-4.3 | i18n framework + first locales |

## 5. Theming Specification (user-requested feature)

**Architecture:** every visual property flows through semantic design tokens (CSS custom properties). Components may only reference tokens; a lint rule bans raw hex/rgb outside token files.

```css
/* token contract (excerpt) */
--kb-bg-canvas        /* app background */
--kb-bg-surface       /* cards, tables */
--kb-bg-raised        /* modals, palettes */
--kb-fg-default       /* primary text */
--kb-fg-muted         /* secondary text */
--kb-accent           /* interactive highlight */
--kb-status-ok|warn|err|pending
--kb-border-subtle|strong
```

| Theme | Mode | Default? |
|---|---|---|
| **Dusk** | dark | ✅ default |
| **Dawn** | light | |
| **System** | follows OS `prefers-color-scheme` (maps to Dusk/Dawn) | opt-in |
| Dusk-HC / Dawn-HC | high-contrast accessibility variants (WCAG AA minimum, AAA where feasible) | opt-in |

Additional requirements:
- Accent-color picker (curated set + custom hue) applied as token overrides.
- Per-theme syntax highlighting palettes for YAML/JSON/logs.
- Theme hot-switch with zero flicker (tokens swap before paint).
- Plugins receive the token set read-only; they cannot inject unscoped styles.

## 6. Performance Budgets (contractual, CI-enforced)

Measured by the Phase-0 harness (kind clusters + synthetic workload generator) on every PR. Red metric ⇒ failing build. Numbers are targets validated against public Freelens/Lens measurements:

| Metric | Budget | Baseline reality (Lens/Freelens) |
|---|---|---|
| Idle RSS — desktop app total (shell+engine), 1 cluster | **≤ 150 MB** | ~300–500 MB typical |
| Idle RSS — 3 clusters connected, 1 actively viewed | ≤ 250 MB | scales worse |
| Cold start → first interactive frame | ≤ 1.5 s | ~3–4 s |
| Installer size (desktop) | ≤ 40 MB | ~150–250 MB |
| Idle CPU after warmup | ≈ 0% (event-driven) | measurable churn reported |
| Scroll 100k-row table | ≥ 55 fps sustained | jank reported |
| Watch-event → painted UI, p95 (local kind) | ≤ 100 ms | n/a |
| Engine memory @ 100k pods watched (metadata mode) | ≤ 400 MB | n/a (most tools OOM/jank) |

Methodology notes live beside the harness; budgets may only change via ADR with evidence.

## 7. Platforms

| Surface | Decision | Rationale |
|---|---|---|
| macOS / Windows / Linux desktop | ✅ Build (Tauri 2) — Phase 1 | Core audience lives here; Tauri keeps the lightweight promise |
| Web (self-hosted, personal) | ✅ Build — Phase 2 | Same binary, near-zero marginal cost; enables browser-only users & SSH boxes |
| In-cluster team deployment (Helm chart + OIDC) | ✅ Build — Phase 2 | Headlamp proved this is the org adoption vector; impersonation keeps RBAC honest |
| **SaaS** | ❌ **Rejected permanently** | Holding user kubeconfigs in a hosted control plane contradicts Principle #1 (trust), creates a breach liability, and Lens demonstrated the reputational failure mode. Team sharing is fully served by self-hosted in-cluster mode. |
| Mobile native apps | ⏸ Deferred behind decision gate (F-4.2) | Real mobile use case is on-call triage (read-only). Responsive web covers it cheaply; exec/YAML editing on phones is anti-UX. Native shells only if usage data demands. |

## 8. Success Metrics (post-launch)

- Time-to-first-log-line < 30 s from install (new user onboarding)
- Weekly active installs (opt-in telemetry only), retention ≥ 60% W4
- Memory/CPU benchmarks published each release vs Freelens (transparency marketing)
- Zero telemetry-related issues open > 30 days (i.e., we keep the promise)
