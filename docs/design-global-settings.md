# Design: global settings on the cluster list page

Status: decided, not built. Owner request: move the settings shared across all clusters to the main cluster list page, and keep them reachable from inside a cluster.

## Decision in one line

Add a **Settings** button to the Clusters page header. It opens a lazy-loaded right-hand Drawer (`?settings=1`) that renders the same settings body as `/settings`. Inside a cluster, `/settings` stays exactly where it is and gains a **This cluster** section. No engine change, no new route.

## Inventory (T1)

Global (one value for the whole machine or engine):
Theme, Display, Default Prometheus URL (fallback), Node shell image, Debug image, Kubeconfig sources (pointer card to the picker), Warm clusters, Change timeline retention, AI / MCP, MCP scope (lists all clusters), AI triage, Extensions, Notifications (including the mute-a-cluster list), Updates, Saved views, Usage history (a list of all clusters with consent; `HistoryClusters` is a map but the card is a global list).

Per cluster / about the open cluster:
- Prometheus "Auto-detected for <cluster>", Change, Test connection (`PrometheusSettings` + `PromTestPanel`, query key `['prom-status', cluster]`, uses `useCluster()`). This is the only block in `Settings.tsx` that reads the active cluster.
- `AppSettings.PrometheusURLs` and `PrometheusTargets` are keyed by cluster. They are edited from each cluster's menu on the Clusters page, not from Settings. They stay there.

Caveat to state in the UI: a URL set for one cluster always wins over the global default.

## Decisions

- **T2 placement.** Header button next to Add kubeconfig, opening a Drawer, state in the URL (`?settings=1`, optional `#section`), mirroring `?kubeconfig=1`. Rejected: section below the list (layout shift, 12 cards of DOM on the landing page), a tab (second navigation mode), moving the page (breaks the cluster shell and every `/settings` link).
- **T3 inside a cluster.** `/settings`, the sidebar entry, the palette and favourites entries and `docs appRoutes: ["/settings"]` are unchanged. The page renders the shared body plus **This cluster** (placed first, id `#this-cluster`). The drawer has no active cluster, so it omits that section. Existing deep links (`/settings#mcp`, `#kubeconfig-sources`, HistoryCoverageChip's `/settings`) keep working; the hash-scroll effect moves into the shared body.
- **T4 locks.** One body, one `['settings']` query. The `sharedLocked` banner text comes from the engine (`SharedSettingsBlockReason`); locked props (default Prometheus URL, node shell image, debug image, pinned service, kubeconfig sources) are passed from that one place. The engine still answers 403 via `refuseIfLocked`. No second lock logic in the picker.
- **T5 one component.** Extract `SettingsBody({ cluster?, onManageKubeconfigs? })` into its own module. `pages/Settings.tsx` becomes a thin wrapper (PageHeader, PageHelp, `useCluster()`). Reuse existing keys (`['settings']`, `['warm-policy']`, `['clusters']`, `['prom-status', cluster]`). No copied state, no store, no new endpoint.
- **T6 speed (first rule).** The picker is the eager landing route and already polls clusters (4 s) and health (10 s). The button adds nothing at first paint: `lazy(() => import(...))` for the body inside `Suspense`, mounted only when open; the settings query is enabled only when open; chunk prefetch on pointer-enter or focus of the button. The drawer is an overlay, so no layout shift. Button is a `@kubebay/ui` `Button`; Drawer handles Escape and returns focus to the button (verify; if the Drawer cannot do it, use `Modal size="wide"`). Failure states: a settings query error or a failed chunk shows an `InlineBanner` ("Couldn't load settings. Kubebay's engine did not answer. Try again.") with Retry; Theme and Display still render because they are client stores; each card handles its own loading, with a skeleton, never a blank panel. This also fixes today's silent blank when the query fails.
- **T7 docs and rules.** No new route, so no new docs page and no new `appRoutes`. Update `website/src/content/docs/settings.md` (open from the Clusters page and the sidebar; add a "This cluster" heading; keep every existing heading) and `connect-clusters.md` (the Settings button). Edit the `/settings` entry in `web/apps/shell/src/lib/help.ts` (shared across all clusters, opens from the Clusters page too); if the `/clusters` entry is edited, mention the button. Add a CHANGELOG entry under Unreleased. The drawer title reuses `<PageHelp route="/settings" />`.

## Disagreements resolved

1. **Kubeconfig card inside the drawer.** One view said keep it as a link to `/clusters?kubeconfig=1`; the other said open the dialog directly. Decision: open directly, through the `onManageKubeconfigs` prop. The user is already on `/clusters`, so navigating is a no-op that closes the drawer for nothing. Inside a cluster the prop navigates to the picker as today.
2. **Help icon.** One view kept PageHelp only on the page wrapper; the other reused it in the drawer. Decision: reuse it in the drawer header, as the content is identical.
3. **Prometheus pin.** Both agree it stays in each cluster's menu on the Clusters page. Decision: This-cluster section shows detection status, Change and the test panel only. Kept for follow-up: whether Change should reuse `ConfigurePrometheusModal`.
4. **Failure banner.** One view treated it as optional polish; the other as required. Decision: required, because of the first rule (no hang, no error).
5. **Out of scope.** `/settings` pasted on a cold start with no cluster keeps `shouldRedirectToPicker` behaviour.

## Build scope

Files:
- new `web/apps/shell/src/pages/settings/SettingsBody.tsx` (moved sections, `cluster?`, `onManageKubeconfigs?`, hash-scroll effect, error banner, This cluster section)
- new `web/apps/shell/src/pages/settings/SettingsDrawer.tsx` (Drawer wrapper, `Suspense`, lazy body, retry on chunk failure)
- edit `pages/Settings.tsx` (thin wrapper), `pages/ClusterPicker.tsx` (button, `?settings=1`, prefetch)
- edit `lib/help.ts`, `website/src/content/docs/settings.md`, `connect-clusters.md`, `CHANGELOG.md`
- not touched: `App.tsx` routes, engine, `@kubebay/ui` (no new component, so no design-system artifact re-sync)

Tests first (Vitest + Testing Library, red before green):
1. Picker renders Settings and makes no `/api/settings` request until clicked.
2. Click opens the drawer and requests settings once; `?settings=1` opens on load; Escape closes and focus returns to the button.
3. `sharedLocked` shows the banner and disables Default Prometheus URL, Node shell image, Debug image and Change, in both `/settings` and the drawer.
4. `/settings` with a cluster shows This cluster; the drawer does not.
5. `/settings#kubeconfig-sources` and `#mcp` still scroll; the drawer's kubeconfig link opens the dialog without navigating.
6. Settings query failure and chunk failure show the plain-language banner with Retry; Theme and Display still render.
7. Guard tests stay green (`shellAdoption`, `themeTokens`, `themeContrast`); `help.test.ts` and `cd website && npm test && npm run build`.

Then `go test ./...`, the repo ship sequence, and the post-ship screenshot check (the picker is the landing page).
