# Kubebay Roadmap

> Effort estimates assume **1–2 focused contributors**; scale linearly for more.
> Each phase ends with a public milestone release. Dates are relative (T0 = scaffold day).

---

## Phase 0 — Foundation  (T0 → T0+6 weeks)

**Goal:** walking skeleton that proves the architecture end-to-end.

| Milestone | Exit criteria |
|---|---|
| M0.1 Monorepo + CI | `engine` + `web` + `e2e` build in CI; golangci-lint, ESLint, actionlint green |
| M0.2 Engine core | kubeconfig load/watch, cluster health, discovery cache |
| M0.3 Protocol v1 | sub/unsub/snapshot/delta/resync over single WS; integration test vs kind |
| M0.4 SPA shell | routing, layout, theme tokens (**Dusk/Dark default, Dawn/Light**), palette skeleton |
| M0.5 Perf harness | kind fixture generator + baseline metrics published (budgets wired into CI as warnings) |

**Demo gate:** live Pod table updating from a kind cluster with <100 ms watch-to-paint.

## Phase 1 — Daily-Driver Parity  (→ ~T0+14 weeks)

**Goal:** a Freelens user can switch for daily work without losing anything they use hourly.

Logs viewer → terminal exec → port-forward manager → quick actions → YAML edit+diff (SSA) →
generic/CRD browsing → metrics → events → namespace/context UX → full command palette →
desktop packaging + auto-update.

**Exit criteria:**
- All P1 features (PRD §4) demoable; Playwright suite covers the "golden path" (connect → browse → logs → exec → port-forward → edit+apply).
- Perf budgets flip from warnings to **hard CI failures**.
- Signed installers for macOS (notarized), Windows, Linux (.deb/.rpm/AppImage).
- Dogfooding rule: team does all its own k8s work through Kubebay for 2 weeks before release.

## Phase 2 — Differentiators  (~T0+20 → T0+32 weeks)

**Goal:** reasons to switch *to* Kubebay rather than *from* Lens.

Topology view → event timeline → RBAC explorer → Helm manager → fleet dashboard →
in-cluster Helm chart (OIDC + impersonation) → GitOps lineage → local audit log.

**Exit criteria:**
- Topology renders a real 50-workload app correctly and live-updates on rollout.
- In-cluster mode passes an OIDC (Keycloak) E2E scenario where a restricted user sees only permitted actions.
- First external contributor lands a feature unaided by maintainers (docs quality check).

## Phase 3 — Platform & Moat  (~T0+40 → T0+56 weeks)

Plugin system GA (WASM + UI slots + signed index) → built-in MCP server → AI copilot
(deterministic analyzers keyless/offline; LLM opt-in, anonymized, read-only default) →
alerts surfacing → marketplace UX.

**Exit criteria:** third-party plugin installs & runs under capability grants; MCP tools usable from Claude Desktop/Cursor against a kind cluster.

## Phase 4 — Reach  (post-T0+56 weeks)

Mobile-responsive read-only web polish → native-mobile decision gate → i18n.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Scope creep toward "Lens parity" obsession | High | High | PRD Non-Goals section is law; parity = *daily workflows*, not feature count |
| Tauri/webview quirks (esp. Linux WebKitGTK) | Medium | Medium | Design system avoids bleeding CSS; Electron fallback is a build target (ARCHITECTURE §9) |
| Watch storms / API-server load on huge clusters | Medium | High | Metadata watches, shared informers, server-side selectors, resync=0; perf harness includes 100k-pod scenario |
| Plugin ecosystem security incident | Low | High | WASM sandbox, capability grants, signed registry (SECURITY.md) |
| Maintainer bandwidth (small team) | High | Medium | Generic GVR layer keeps per-kind cost near zero; ruthless phase gates |
| K8s version skew breaks streaming | Low | Medium | WS-first w/ SPDY fallback matrix in E2E (kind runs 3 versions) |
| Name/brand collision discovered late | Low | Low | Kubebay vetted Aug 2026; trademark search before v1.0 marketing push |

## Definition of Done (every merged feature)

1. Unit tests + (where applicable) Playwright coverage
2. Perf harness re-run — no red metric regression
3. Docs updated (feature doc + screenshots)
4. Security review checklist if it touches auth/exec/plugins
5. Works on all three desktop platforms (CI matrix proof)
