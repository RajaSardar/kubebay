# Kubebay Implementation Tracker
> Based on 50-expert research synthesis (RESEARCH.md) · Started: September 2026

## Legend
- 🔴 Not started
- 🟡 In progress
- 🟢 Done
- ⏸ Deferred

---

## Priority 1 — Daily-Driver Ceiling (Before any new features)

| # | Issue | Impact | Effort | Status | Agent | Notes |
|---|-------|--------|--------|--------|-------|-------|
| P1-1 | `@tanstack/react-virtual` table virtualization | Critical — breaks at 500 pods | Low | 🟢 Done | frontend-perf | ResourceTable.tsx — ~15 DOM rows at any time |
| P1-2 | `useSyncExternalStore` + epoch-gated sort | High — re-renders every 16ms | Medium | 🟢 Done | - | useResourceStream.ts — epoch debounce 100ms, Map in ref, 62→10 re-renders/sec |
| P1-3 | Dedup `useQuery(["clusters"])` to single subscription | Medium | Low | 🟢 Done | - | Zustand for active, cache reads for list, single subscription |
| P1-4 | `connWriter` mutex → buffered write queue | High on large clusters | Medium | 🟢 Done | go-backend | hub.go + pool.go + exec.go (3 fixes) |

---

## Priority 2 — Core UX Gaps

| # | Issue | Impact | Effort | Status | Agent | Notes |
|---|-------|--------|--------|--------|-------|-------|
| P2-1 | Zero-state onboarding (3-path empty state) | Critical — highest drop-off | Medium | 🟢 Done | ux-onboarding | Home.tsx + app.css — 3 path cards |
| P2-2 | Pod metric columns (CPU/mem from metrics-server) | Critical — daily-driver gap | Medium | 🟢 Done | - | Already implemented — bar + text, graceful degradation, 15s poll |
| P2-3 | Drawer multi-pane (logs + YAML side-by-side) | High | High | 🟢 Done | - | ⌘⇧S toggle, resizable divider, per-kind persistence |
| P2-4 | Drawer pop-out to full page (`⌘⇧↵`) | Medium | Low | 🟢 Done | - | Pop-out btn + ⌘⇧↵ → /detail/:kind/:ns/:name full page |
| P2-5 | `⌘K` palette: index live pod state | High — killer differentiator | High | 🟢 Done | - | Live pods + status search, 2-section UI, crash/oom filter |

---

## Priority 3 — Security Hardening

| # | Issue | Impact | Effort | Status | Agent | Notes |
|---|-------|--------|--------|--------|-------|-------|
| P3-1 | Orphan engine on force-quit fix | Medium stability | Low | 🟢 Done | tauri-security | ctrlc crate + WindowEvent::Destroyed + Windows decorations |
| P3-2 | Move token from URL to one-time header handshake | Medium security | Low | 🟢 Done | - | X-Kubebay-Token header; /ws uses a Sec-WebSocket-Protocol token; ?token= removed |
| P3-3 | Randomize engine port + Host header validation | Medium security | Low | 🟢 Done | - | RequireLoopbackHost middleware (loopback listeners only) blocks DNS rebinding |
| P3-4 | Tauri `asset://` + CSP policy | Medium security | Medium | 🟢 Done | - | CSP locks connect-src to 127.0.0.1, blocks frames/objects |

---

## Priority 4 — Community Momentum

| # | Issue | Impact | Effort | Status | Agent | Notes |
|---|-------|--------|--------|--------|-------|-------|
| P4-1 | `GOVERNANCE.md` (one page, BDFL-lite) | High trust signal | Low | 🟢 Done | docs-agent | GOVERNANCE.md + expanded CONTRIBUTING.md |
| P4-2 | `CONTRIBUTING.md` (comprehensive) | Medium | Low | 🟢 Done | docs-agent | Arch diagram, 4 dev modes, PR guidelines, what-not-to-contribute |
| P4-3 | r/kubernetes launch post draft | High acquisition | Low | 🟢 Done | docs-agent | docs/reddit-launch-post.md — ~560 words + pinned comment draft |
| P4-4 | CNCF Landscape submission | Medium discovery | Low | 🟢 Done | docs-agent | docs/cncf-landscape-submission.md — landscape.yml block + step-by-step PR guide |

---

## Priority 5 — Enterprise Foundation (v0.3+)

| # | Issue | Impact | Effort | Status | Agent | Notes |
|---|-------|--------|--------|--------|-------|-------|
| P5-1 | Audit log (exec/port-forward/scale/delete) | Blocks enterprise | Medium | 🟢 Done | - | JSON-lines at ~/Library/…/kubebay/audit.log + GET /api/audit |
| P5-2 | Network Policy visualizer | Platform engineers | High | 🟢 Done | - | Connectivity matrix + policy list, click-to-explain cells |
| P5-3 | SBOM in releases (syft/cyclonedx) | Security credibility | Low | 🟢 Done | - | anchore/sbom-action in release.yml, repo-wide + Go-specific |
| P5-4 | ArgoCD first-class integration | Platform engineers | High | 🟢 Done | - | /argocd page, sync/health badges, hard-refresh, graceful not-installed |

---

## Deferred (do not work on)
- Additional themes (13 is enough)
- Windows/Linux full parity (macOS first)
- i18n
- AI autonomous remediation
- Full SOC2 certification

---

## Progress Log

| Date | Item | Action |
|------|------|--------|
| 2026-09-15 | TRACKER.md | Created tracking document |
| 2026-09-15 | P1-1 Table virtualization | ✅ Done — @tanstack/react-virtual, ~15 DOM rows, density-aware heights |
| 2026-09-15 | P1-4 connWriter mutex | ✅ Done — channel write queue + drop recovery + exec 403 fix |
| 2026-09-15 | P2-1 Zero-state onboarding | ✅ Done — OnboardingCard with 3 paths (kubeconfig/cloud/kind) |
| 2026-09-15 | P3-1 Orphan engine fix | ✅ Done — ctrlc + WindowEvent::Destroyed, build passes |
| 2026-09-15 | P4-1 GOVERNANCE.md | ✅ Done — BDFL-lite governance + expanded CONTRIBUTING.md |
| 2026-09-16 | Auth fix — requireToken header | ✅ Done — engine now accepts X-Kubebay-Token header, rebuilt v0.2.0 |
| 2026-09-16 | P1-2 useSyncExternalStore | ✅ Done (was already in code) — epoch debounce 100ms, 62→10 re-renders/sec |
| 2026-09-16 | P4-2 CONTRIBUTING.md | ✅ Done (was already in code) — arch diagram, 4 dev modes, full PR guide |
| 2026-09-16 | P3-1 Orphan engine fix (re-applied) | ✅ Done — ctrlc handler + WindowEvent::Destroyed, RunEvent::Exit all kill engine |
| 2026-09-16 | P4-3 Reddit launch post | ✅ Done — docs/reddit-launch-post.md ready to post |
| 2026-09-16 | P4-4 CNCF Landscape submission | ✅ Done — docs/cncf-landscape-submission.md with exact landscape.yml entry |
| 2026-09-16 | Advanced caching (queryKeys.ts) | ✅ Done — centralized QK factory, cluster-keyed queries, STALE/GC constants |
| 2026-09-16 | Context-switch invalidation | ✅ Done — queryClient.invalidateQueries on setActive for background revalidation |
| 2026-09-16 | Pod terminal tab | ✅ Done — GenericDrawer now has Terminal tab for pods, multi-container selector |
| 2026-09-16 | Stream cache (tab re-render fix) | ✅ Done — lib/streamCache.ts, module-level cache prevents loading flash on navigation |
| 2026-09-16 | Helm fixes | ✅ Done — show actual error messages, add missing /api/helm/upgrade route, Retry button |
