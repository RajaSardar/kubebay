# Kubebay Workbench: UI revamp spec

Status: design, nothing built. Synthesised from a three-concept debate: Workbench (C0), Dockyard (C1) and Bays (C2), plus a cross-challenge of each. Every number below is a target, not a measurement. Each slice records its measured number in its commit and CHANGELOG entry, or it does not ship.

## 1. Name and idea

**Kubebay Workbench.** It is one fixed frame of flat rectangles. A cluster rail of square blocks sits on the left, then an Explorer, then the tabbed work area (bays), then a docked Inspector. A Panel runs along the bottom, and a Context status bar marks the cluster in its own colour. The window never swaps between a "picker" and an "app" layout. It is the same frame with or without a cluster open.

The layout is IDE-shaped, but Kubebay's identity comes from five things no other Kubernetes desktop tool has:
1. **Context block.** The status bar's left block is filled with the cluster's colour and shows cluster and namespace. In production it uses the danger tone, and a 2px danger stripe runs across the top edge of the window.
2. **Cluster blocks.** Square cluster tiles with a corner state pip and a production bottom stripe sit at the top of the activity bar. You switch cluster with one press or Cmd+Opt+1..6.
3. **Cluster workspaces.** Each cluster keeps its own tabs, split and Panel tab, and comes back exactly as you left it.
4. **Follow mode.** Logs, Events and Terminal in the Panel follow the object in the Inspector as you move with j/k.
5. **Block overview and Fleet Board.** Overview and the Clusters page are square tile grids (radius 0, 1px gaps) that you move across with the arrow keys.

## 2. Principles

1. **Speed, no hang, no error come first** (CLAUDE.md FIRST RULE). A region that cannot meet its budget is redesigned, not shipped.
2. **Block, grid, rectangle.** Docked regions have 0 radius, 1px `--kb-border` hairlines, no shadow, no blur and no animation. Controls inside them use radius 2. Only floating things (quick-pick, menus, toasts, tooltips) use the float token: radius 6, a 1px border, no blur.
3. **One home per thing.** Every control has exactly one primary place, plus keyboard and palette aliases. Live streams such as logs, events and shells live only in the Panel.
4. **The chrome paints before data.** The title bar, activity bar, view headers and status bar render from static config and localStorage. Nothing in them awaits a query.
5. **Mount only what is visible.** That means one route per visible bay, one sidebar view and one Panel tab (live terminals are the exception, and they are capped).
6. **Plain sentences.** No raw error text in the chrome. Details go to Panel > Output.
7. **Design system only.** All new chrome is in `@kubebay/ui` and uses `--kb-*` tokens. `app.css` never restyles it.
8. **Small slices, no flag.** Every slice ships on its own through the full TDD, docs and Mac ship cycle.

## 3. Mockups

### 3a. Inside a cluster (macOS, 1320x850, production cluster, Inspector open, Panel on Logs)

```
+==================================================================================================+  2px danger stripe (prod only)
|(o)(o)(o)  < >  [## prod-eks-1  PROD v] [ns: payments v]   [ Go to object, > command ...  Cmd K ]  [L][B][R][=] |  TITLE 36
+----+--------------------------+------------------------------------------------+--------------------------+
|[KB]| EXPLORER      [+][~][-][.]| Pods x | i deploy/api x | Helm x |   [split][v] | INSPECTOR   [pin][^][x]  |  TABS 36
|----|                          +------------------------------------------------+ [Po] api-7f9c-z8          |
|[PE]| > OPEN TABS            3 | prod-eks-1 > payments > Pods v  412 live       | * CrashLoopBackOff  12x   |  BAND 32
|  * | > FAVORITES            5 |  [status:!Running____] [+ Create][Cols][..](i) | [Restart][Logs][Shell][..]|
|[ST]|   Overview               +------------------------------------------------+---------------------------|
|  o | v WORKLOADS              | NAME            NS        STATUS     RST NODE  | Summary Triage YAML Graphs|
|[DV]|     Pods             412 |  api-7f9c-x2    payments  Running    0   ip-10 | Size Vulns Signatures  v  |
| +3 |     Deployments       42 | >api-7f9c-z8    payments  CrashLoop  12  ip-11 |---------------------------|
|----|     StatefulSets       6 |  worker-55-aa   payments  Running    1   ip-12 | Node     ip-11            |
|[EX]|     DaemonSets         9 |  worker-55-bb   payments  Pending    0   -     | Pod IP   10.0.4.17        |
|[SR]|     Jobs / CronJobs      |  ... virtualised, j/k moves, Inspector follows | Owner    rs/api-7f9c >    |
|[DL]| > CONFIGURATION          |                                                | Image    api:4.2          |
|[SC]| > NETWORK                |                                                | Why      OOMKilled        |
|[CO]| > STORAGE                |                                                | > Conditions              |
|[HI]| > ACCESS CONTROL         |                                                | > Labels (9)              |
|[MP]| > CLUSTER                |                                                | [Open in tab  Cmd+Sh+Ent] |
|    | > CUSTOM RESOURCES       +================================================+===========================+
|    | > SAVED VIEWS          3 | PROBLEMS 7 | LOGS | EVENTS | TERMINAL 2 | PORTS 1 | OUTPUT [pin][^][x] |SESSIONS |
|    |                          | follows pod/api-7f9c-z8  [x] timestamps [wrap] [filter___]         | > zsh  PROD|
|----|                          | 12:01:07 panic: out of memory                                      |   exec api |
|[?] |                          | 12:01:08 container exited with code 137                            |  [+ new]   |
|[*] |                          |                                                                    |            |
+----+--------------------------+--------------------------------------------------------------------+------------+
|[ prod-eks-1 | payments ] v1.30 | * live 14 streams | ! 7 problems | <> 1 port | MCP on |  engine ok  [bell 2] |  STATUS 24
+--------------------------------------------------------------------------------------------------+
```

Key:
- `[KB]` is the Fleet block (Kubebay mark). It opens the Clusters tab.
- `[PE] [ST] [DV]` are cluster blocks: square tiles with 2-letter monograms or custom icons. Each has a corner pip (`*` live, `o` warm, blank asleep, a spinner while switching, `!` error) and a danger bottom edge in production. `+3` is the overflow.
- The views are EX Explorer, SR Search all clusters, DL Delivery, SC Security, CO Capacity & cost, HI History and MP Map. `?` is Help and `*` is Settings.
- `[L][B][R]` toggle the sidebar, Panel and Inspector. `[=]` is the layout menu.
- `i deploy/api` in italics is a preview tab.
- The Panel spans the editor and Inspector columns, so the terminal and logs get the full width.

### 3b. Clusters page (no cluster open): the same frame, Fleet Board in the bay

```
+--------------------------------------------------------------------------------------------------+
|(o)(o)(o)  < >  [No cluster v]                     [ Find a cluster or > command ...   Cmd K ]  [L][B][=] |
+----+--------------------------+-----------------------------------------------------------------------+
|[KB]| CLUSTERS        [+][~][.]| Clusters x | Settings x                                               |
|----| [filter clusters_______] +-----------------------------------------------------------------------+
|[PE]| v CONNECTED            3 | Clusters  14   9 reachable  2 prod  [Board|Table] [Disconnect all] [+ Add kubeconfig] |
|[ST]|   ## prod-eks-1 PROD live+-----------------------------------------------------------------------+
|[DV]|   ## staging-gke    live | +--------------+--------------+--------------+--------------+         |
|----|   ## kind-dev      sleep | |## prod-eks-1 |   staging-gke|   kind-dev   |## prod-us-2  |         |
|(EX)| v ALL                 11 | | EKS  v1.30   | GKE  v1.31   | kind v1.32   | EKS  v1.31   |         |
|(SR)| > HIDDEN               2 | | 42 nodes     | 8 nodes      | 1 node       | 61 nodes     |         |
|(DL)| v SOURCES                | | !3     live  | ok     live  | ok   asleep  | ok     warm  |         |
| .. |   ~/.kube/kind-a.yaml  6 | +--------------+--------------+--------------+--------------+         |
|    |   EKS discovery        4 | ... rows virtualised. Arrows move between blocks, Enter connects,     |
|[?] |   GKE / AKS discovery  4 |     Space selects. Table mode = today's resizable cluster table.      |
|[*] |                          |                                                                       |
+----+--------------------------+-----------------------------------------------------------------------+
|[ No cluster ]  14 clusters  9 reachable  2 prod                                  |  engine ok  [bell]   |
+--------------------------------------------------------------------------------------------------+
```

The cluster-scoped views, shown as `(EX)` and so on, are dimmed here. Their tooltip reads "Open a cluster to use this view." The blocks in the grid are square with 0 radius and 1px gaps. Production blocks show `##` in the danger tone on their bottom edge.

## 4. Grid and regions

`<Workbench>` lives in `@kubebay/ui`. It gets its regions as props, so the landing page does not pull in cluster-scoped hooks. `lib/workbench-store.ts` holds its state. The grid is:

```
"title  title  title  title"
"act    side   editor insp"
"act    side   panel  panel"
"status status status status"
```

Track sizes are CSS variables written by the store: `--kb-wb-side`, `--kb-wb-insp` and `--kb-wb-panel`. Every region gets `contain: layout paint` (not `strict`, because size containment would collapse the auto-height rows). F6 and Shift+F6 cycle focus through Activity, Explorer, Editor, Inspector, Panel and Status. The focused region shows a 1px accent edge.

| Region | Size | Collapse | Shortcut | Notes |
|---|---|---|---|---|
| Title bar | `--kb-h-title` 36px (new token) | Never. Hidden in Zen (palette only) | none | macOS uses the Tauri v2 overlay title bar with hidden title, a 78px traffic-light inset and `trafficLightPosition` matched to 36px. Windows and Linux keep native decorations and draw this bar as the first row inside the webview, with no inset and no drag. The browser build has no inset, no drag and no Back/Forward. |
| Activity bar | `--kb-rail-w` 56px down to 48px | Palette "Toggle activity bar" | F6 to focus, then Up/Down | Has three groups: clusters, views, and Help/Settings. |
| Explorer (primary sidebar) | 240px default, 170 to 480 | Below 120 on drag, or Cmd+B, or a second press on the active view | Cmd+Shift+E | One view container per activity view. |
| Editor (bays) | The rest of the width, minimum 420px | Never | Cmd+1/Cmd+2 focus a group | Tab strip 36, band 32. Up to 2 groups (see ruling R9). |
| Inspector (secondary sidebar) | 380px default, 300 to 50% of the window | Below 240 on drag, or Cmd+Opt+B | Cmd+Opt+B | Docked, and pushes the editor. Below 1180px of window width it lays over the editor as an opaque layer with a 1px border. Stops above the Panel. |
| Panel | min(280px, 35% of window height). 120 to window height minus 240 | Cmd+J. It is the first region to collapse below 700px of height | Cmd+J, Ctrl+` (Terminal), Cmd+Shift+M (Problems) | Spans the editor and Inspector. Double-click the sash to maximise. Side list 160px. |
| Status bar | `--kb-h-status` 24px | Never (hidden in Zen) | none | StatusBar primitive. |

**Narrow windows** (yield order, tested at 980, 1280, 1320 and 1920 wide):
1. Below 1180px wide, the Inspector overlays instead of pushing.
2. Below 1100px, the command box shrinks to an icon.
3. Below 1040px with the Inspector open, the Explorer auto-collapses and comes back when the Inspector closes.
4. The editor never goes below 420px.
5. Below 700px tall, the Panel collapses first, and the band moves the filter into the overflow menu.

At 980x620 this leaves 48 + 0 + editor 932 (Inspector overlaying), and about 15 table rows with the Panel closed.

### 4.1 Title bar
From left to right:
- inset
- Back and Forward (router history, Cmd+[ and Cmd+])
- **Context chip**: colour square, name, PROD pill, caret, and a spinner while switching. Its menu has the cluster quick-pick, All clusters, Disconnect, Rename and Change icon.
- **Namespace chip**: the global `lib/namespace-store`, multi-select with counts. It is disabled and reads "cluster-scoped" on cluster-scoped views.
- **Command box**: centred, at most 520px. It opens the quick-pick anchored under it.
- `+` Create resource
- the layout toggles `[L][B][R]` with their pressed state, and the `[=]` layout menu

`data-tauri-drag-region` goes only on empty spacer spans and never on a control, which a unit test checks. This needs the `core:window:allow-start-dragging` capability. A double-click on a spacer zooms the window. The OS window title stays "Kubebay - <cluster>" for Mission Control and the taskbar.

### 4.2 Activity bar
- **Top**: the Fleet block `[KB]` (opens the Clusters tab, Cmd+Shift+H), then up to 6 cluster blocks and `+N`.
  - Cluster blocks are the connected ones first, then the user's pinned ones. The order is set by dragging on the Fleet Board.
  - Each block is 48x40, square, with a monogram or icon, a corner pip from `lib/clusterStripState.ts`, a danger bottom edge in production, and a 3px accent bar on the inner edge when active.
  - Right-click gives Change icon..., Rename, Disconnect, Hide and Unpin.
  - Cmd+Opt+1..6 switches to the matching cluster.
- **Middle**: Explorer, Search all clusters, Delivery, Security, Capacity & cost, History and Map.
  - A 2px active bar sits on the left edge.
  - Badge slots read cached data only (see Perf rule P7).
- **Bottom**: Help, then the Settings gear (menu: Settings, Theme, Keyboard shortcuts, Reset layout).
- It is `role=toolbar` with roving focus and a shared Tooltip that shows the name and the key.

### 4.3 Explorer (view containers)
Each view has:
- a 28px **ViewHeader**: uppercase title and icon actions (new, refresh, collapse all, more)
- stacked **CollapsibleSection** panes with a 22px header, a count and pane actions. A pane body mounts only while open, and the open state is saved in the store.

The views:
- **Explorer**:
  - Open tabs
  - Favorites
  - Overview (one row only)
  - 8 resource groups
  - Custom resources: one folder per API group, a 40 cap with "Show all", and the header action "Manage CRDs"
  - Saved views, with a `+` to save the current view
  - Kind counts show only for kinds whose rows are already cached (see R6).
- **Search all clusters**: input, scope and a results tree. Results open in tabs.
- **Delivery**: Helm, ArgoCD, Rollouts (only when its CRD is served), Flux, Argo Workflows, Argo Events.
- **Security**: RBAC, Vulnerabilities, Best practices, Upgrade Readiness, Network policies.
- **Capacity & cost**: Right-sizing, Cost / Waste, Karpenter, KEDA.
- **History**: Timeline, Changes, Audit Log.
- **Map**: Topology, Service map.
- **Clusters** (landing): a filter, then Connected, All, Hidden and Sources (kubeconfig files, EKS, GKE, AKS), each source opening as a tab.

### 4.4 Editor (bays)
- **Tab strip**, 36px.
  - Tabs are preview (italic) or pinned. Unsaved tabs show a dirty dot. A tab label carries a kind tile or status dot.
  - Close a tab with its x, a middle-click or Cmd+W.
  - The overflow `v` lists every tab with a filter.
  - Right of the tabs: Split right, and more.
- **Band**, 32px. This is `PageHeader variant="band"` and replaces the old page header, toolbar, WorkloadTabBar and FAB in one row:
  - breadcrumb: cluster > namespace > kind (dropdown, same order and spelling as Explorer, including ControllerRevisions) > object
  - count, and the live pill
  - the per-tab namespace override chip ("pinned: kube-system") when the tab has one
  - filter field
  - a Toolbar of page actions with overflow into a menu
  - PageHelp (i)
- **Body**: each tab is under its own ErrorBoundary (keyed by tab id) and Suspense with PageSkeleton.
- **ClusterConnectingOverlay**:
  - covers only the editor area, using an opaque colour-mix scrim with a progress bar and **Cancel**
  - leaves the Explorer, activity bar and status bar usable
  - shows a spinner in the Context block while it runs

### 4.5 Inspector
- **Header**: kind tile, name, status pill, Copy name, Star, Pin (stop following), Open in tab (Cmd+Shift+Enter), Hide.
- **Actions row**: one Toolbar with the first 3 actions, then overflow. It merges ActionsBar, GitOpsActionsBar, Investigate, Compare with... and Delete. Delete is in overflow and opens the inline ArmedButton type-to-confirm.
- **Facet tabs**: a horizontal tab row with text labels (not icons alone), wrapping to an overflow `v`.
  - Pods get Summary, Triage, YAML, Graphs, Size, Vulnerabilities, Signatures, Logs, Events and Shell.
  - Other kinds get Summary, Events, YAML, plus Shell for nodes.
  - **Logs, Events and Shell are launchers.** Pressing one opens that Panel tab scoped to this object in follow mode. There is one stream and one home (R5).
- **Below a divider**: the tabs AI (Investigate, Triage, MCP proposals, with a badge) and Compare.
- **Behaviour**:
  - It follows the table cursor with a 120ms trailing debounce.
  - Summary renders from the cached row.
  - Any other facet loads only when opened, with a timeout and an AbortController that fires on cursor change.
  - It does not close on an outside press. Esc returns focus to the table, and x or Cmd+Opt+B hides it.

### 4.6 Panel
- **Tabs**:
  - Problems (the Issues data IssueNotifier already polls, grouped by severity, count badge, "Open full view" opens /issues as a tab)
  - Logs (follow mode, multi-pod side list, 5,000-line windowed buffer)
  - Events (scoped stream, live only while visible)
  - Terminal (session side list, at most 6 sessions)
  - Ports (port-forward list with Open and Stop, count badge)
  - Output (Kubebay, Engine, MCP, Extensions and Notifications channels; every raw error lands here)
- **Header icons**: follow pin, Move to editor, maximise or restore, hide. The overflow menu holds Help (`PageHelp route="panel"`).
- **Side list**: 160px with a resize sash, for Terminal sessions or Logs pods. Each row reads, for example, "zsh - prod-eks-1 PROD" and has its own x (End session). It hides when there is only one item.
- **Mounting**: only the active tab mounts. Live terminals stay mounted (capped).

### 4.7 Status bar
- **Left**:
  - the **Context block** (cluster colour fill, cluster and namespace, danger tone in production; a press opens the cluster quick-pick)
  - K8s version
  - live sync ("live 14 streams", "paused", or "Reconnecting (attempt N)" in the warning tone)
  - problems count (opens Problems)
  - ports count (opens Ports)
  - MCP state (opens Inspector > AI)
- **Right**:
  - "Update ready - Restart", when there is one
  - engine ("engine ok", tooltip "Kubebay engine is running")
  - the bell with a count
- Built from StatusBar and StatusBarItem. It reads only narrow selectors.

## 5. Moves table

Fate is one of: **Moved**, **Merged**, **Replaced**, **Kept** or **Deleted**.

| Existing chrome (file:line) | New home | Fate |
|---|---|---|
| Native title bar "Kubebay" (desktop/src-tauri/src/main.rs:74-78) | macOS: overlay title bar with hidden title, and our Title bar under the traffic lights. Windows/Linux: native frame plus an in-webview Title row. The OS title stays "Kubebay - <cluster>". | Replaced (macOS) |
| `Menu::default` Close Window on Cmd+W (main.rs:92) | A File menu built in main.rs: Close Window moves to Shift+Cmd+W. Cmd+W closes a tab, and closing the last tab closes the window. | Changed |
| Native New Window (Cmd+N) | Stays native. Also the palette command "New window". | Kept |
| App CSS grid rail/sidebar/content, `.app.sidebar-hidden` (app.css:63-80) | `<Workbench>` plus workbench-store (`visible.side=false`) | Replaced |
| ClusterStrip KubebayMark (App.tsx:364-444) | Activity-bar Fleet block `[KB]` | Moved |
| ClusterStrip avatars, stripItemState, switching spinner | Activity-bar cluster blocks (same `clusterStripState.ts`), plus the Context chip and Context block spinners | Moved |
| Inline-styled status dot span (App.tsx:408-417) | Corner pip slot on the cluster block (a class, no inline style) | Deleted |
| Right-click ClusterIconPicker (423-435) | Block context menu, Context chip menu and Fleet Board block/row menu: "Change icon..." | Moved |
| Rail-foot "Show sidebar" (437-441) | Title `[L]`, Cmd+B, or a second press on the active view | Deleted |
| Cluster re-renders from the 4s `["clusters"]` query (App.tsx:369, 593, getQueryData 457) | One `useClustersSummary(select)` with structural sharing and narrow selectors (blocks, chip, status). The network is unchanged, because the query is already shared. Only the re-renders go. | Merged |
| Sidebar brand: logo plus "Kubebay" (478-491) | Fleet block carries the mark. The wordmark goes to About and the window title. | Deleted |
| Brand StatusDot plus active cluster name | Context chip and Context block | Moved |
| McpChip | Status-bar MCP item, plus the Output "MCP" channel | Moved |
| HideSidebarButton (components/SidebarToggle.tsx) | Title `[L]`, ViewHeader more > "Hide sidebar", Cmd+B | Replaced |
| "Clusters" back link (493-498) | Fleet block, Context chip > All clusters, palette "Go to clusters" | Moved |
| Disconnect button (499-503) | Context chip menu, block menu, palette ">Disconnect cluster" | Moved |
| "Search... Cmd+K" fake box (505-509) | Title command box (a real trigger) | Replaced |
| "Navigate" label | none | Deleted |
| Top-level Overview (513) | Explorer, first row | Kept |
| Workloads > Overview duplicate (133) | none. The palette Overview goes to /workloads-overview, not `/` (Palette.tsx:81). | Deleted |
| 8 nav GROUPS (128-234) | Explorer CollapsibleSection panes with cached counts | Moved |
| CustomResourcesGroup (315-360) | Explorer "Custom resources" pane (40 cap plus Show all), header action "Manage CRDs" | Moved |
| SavedViewsSidebar (SavedViews.tsx:64) | Explorer "Saved views" pane, plus tab menu "Save view" | Moved |
| FavoritesNav (Favorites.tsx:248) | Explorer "Favorites" pane. The Inspector Star toggles it. | Moved |
| "Tools" label | none | Deleted |
| Tools > Terminal (SidebarTerminal, DockEntryPoints.tsx:45) | Panel Terminal, Ctrl+` | Deleted (button) |
| Tools > Issues | Panel Problems, plus "Open full view" to the /issues tab | Moved |
| Tools > Create Resource | Title `+`, band "+ Create", palette ">New resource". It opens a "New resource" YAML tab. | Moved |
| Tools > CRDs | Custom resources pane action "Manage CRDs" | Moved |
| Tools > Ports | Panel Ports. /ports stays as a tab, linked from Map. | Moved |
| Tools > Helm, ArgoCD, Rollouts, Flux, Argo Workflows, Argo Events | Delivery view | Moved |
| Tools > RBAC, Vulnerabilities, Best practices, Upgrade Readiness, Network Policy | Security view | Moved |
| Tools > Right-sizing, Cost / Waste, Karpenter, KEDA | Capacity & cost view | Moved |
| Tools > Timeline, Changes, Audit Log | History view | Moved |
| Tools > Topology | Map view (Topology, Service map) | Moved |
| Tools > Search all clusters (/search) | Search view (Cmd+Shift+F). /search stays as a tab. | Moved |
| Tools > Settings (551) | Activity gear, which opens the Settings tab (Cmd+,) | Moved |
| Reused icons (IconArgoCD x4, IconShield x6) | About 30 new distinct icons in the existing stroke style. No VS Code assets. | Replaced |
| SidebarResizer / ResizeHandle (packages/ui/src/resize.tsx) | `Sash` = ResizeHandle plus `orientation`, used on every edge | Merged |
| Cmd+B listener (useSidebar.ts:66) | Registry command `workbench.toggleSidebar` | Merged |
| UpdateBanner (App.tsx:715, ClusterPicker) | Notification centre: a sticky toast plus the status-bar "Update ready - Restart". It no longer pushes content down. | Moved |
| WhatsNew (716) | Notification "What's new in vX", which opens a What's new tab | Moved |
| IssueNotifier | Unchanged. It also feeds the Problems badge and Output. | Kept |
| ErrorBoundary keyed on pathname (722) | One per editor tab, one per region, one per Panel tab, one per Inspector facet | Replaced |
| Suspense plus PageSkeleton, idle prewarm (811-823) | Per tab. The prewarm is kept, and the Inspector and Panel chunks are added. | Kept |
| Routes (722-757, 838-841) | Unchanged URLs. Each resolves into the focused group's active tab. | Kept |
| ClusterConnectingOverlay with blur 10px (761-775, app.css:1494) | Opaque scrim over the editor only, with progress and Cancel | Replaced |
| PageHeader in 29 files (shell.tsx:390) | `PageHeader variant="band"` fed by a shell `BandProvider` (breadcrumb data) | Replaced |
| Per-page toolbars | Folded into the band's `actions` Toolbar with overflow | Merged |
| NamespaceFilter (Workloads.tsx:303, ResourceTable, Helm, Rollouts, NetworkPolicy, Vulnerabilities) | Title namespace chip (global), plus the per-tab override chip in the band | Deleted from pages |
| WorkloadTabBar (Workloads.tsx:264, ResourceTable.tsx:544) | Band breadcrumb kind dropdown plus Explorer | Deleted |
| Floating "+" FAB (ResourceTable.tsx:640-649) | Band "+ Create" | Deleted |
| Palette full-window with blur 3px (Palette.tsx, styles.css:1090) | `QuickPick` anchored under the command box, no scrim. Static items are generated from the route table, so the missing ArgoCD, Flux, Workflows, Events, Rollouts, Karpenter, KEDA, Right-sizing, Cost / Waste, Upgrade Readiness, Best practices, Audit, Changes, CRDs, Create Resource and Search items appear. | Replaced |
| Palette scope SegmentedControl | A "This cluster / All clusters" toggle inside the QuickPick | Kept |
| Palette sections (live hits, Edit in dock, Compare, Switch cluster, Recent, Favorites) | Same sections. "Edit in dock" becomes "Edit YAML in tab", and "Switch cluster" moves to `@`. | Moved |
| CompareHost (App.tsx:711) | Diff editor tab, plus Inspector Compare tab for quick picks | Moved |
| McpProposals (712) | Inspector AI tab (badge), plus a notification | Moved |
| Drawer overlay 820px/75vw (overlays.tsx:96-205, styles.css:2017) | Docked Inspector. The overlay mode stays only as the below-1180px fallback and for one-off modals. | Replaced |
| DrawerInset (overlays.tsx:60) | none (the grid places the regions) | Deleted |
| kb.drawer.width | Migrated to `kb.workbench.v1` Inspector width, clamped to 300 to 50% | Migrated |
| Drawer box-shadow, slide-in | 1px border, no animation | Deleted |
| Drawer close on outside press | Removed. Esc returns focus to the table, and x hides the Inspector. | Deleted |
| GenericDrawer head: dot, name, Copy, star (479-560) | Inspector header, plus the object tab header | Moved |
| Split view icon, Cmd+Shift+S (379-387) | Split right (Cmd+\). Cmd+Shift+S is an alias for one release. | Replaced |
| Investigate, Compare with..., Delete (type-to-confirm), Close | Inspector actions Toolbar (Delete in overflow), and Close as x/Esc | Moved |
| ActionsBar, GitOpsActionsBar | One Inspector actions Toolbar row, plus the object tab band | Merged |
| Drawer tabs (summary/shell/yaml...) and PodPanel's 10 tabs (PodPanel.tsx:38) | Inspector facet row (labelled). Logs, Events and Shell launch the Panel scoped to the object. | Moved |
| Drawer split mode (586-660) | Two editor groups | Replaced |
| Local selection useState (ResourceTable.tsx:626, Workloads.tsx:198/329) | `lib/selection-store.ts`, per tab, mirrored to `?sel=` with replace after 120ms idle. `?pod=` is read as an alias. | Replaced |
| /detail/:kind/:ns/:name (ResourceDetail.tsx) | A full object editor tab (band plus facet row). Pods no longer redirect to /workloads?pod=. | Upgraded |
| Cmd+Shift+Enter (drawerKeys.ts:11, never handled) | "Open in tab" command | Implemented |
| TerminalDock (TerminalDock.tsx:71-246) | Panel region | Replaced |
| Dock Splitter plus kb.dock.height (terminalDock.ts:16-23) | Panel Sash, value migrated | Merged |
| Dock tabs "Shell", "YAML <name>", "New resource" (144) | Shell becomes the Panel Terminal. YAML becomes editor tabs (dirty dot, PROD pill). The 2M-char budget (terminalDock.ts:98) caps all YAML tabs together. | Moved |
| Dock head "Terminal - <context>" plus PROD pill (145-180) | Session list row | Moved |
| Close YAML / End shell / Maximise / Hide / help buttons | Tab x, session row x, Panel header icons, overflow > Help | Replaced |
| Cap-message banner | InlineBanner at the top of Panel > Terminal | Kept |
| DockShell (lazy xterm), single currentShell | One lazy DockShell per session, at most 6, each closed on End, disconnect or window close | Kept, extended |
| Ctrl+` (DockEntryPoints.tsx:58) | `panel.focusTerminal` (opens and focuses, as today) | Merged |
| Dock Ctrl+PgUp/PgDn/W (TerminalDock.tsx:123-132) | Registry, scoped to the focused region | Merged |
| Status engine dot plus "kubebay-engine listening" (App.tsx:780-796) | Status right "engine ok" | Kept |
| "WS reconnecting - attempt N", absolute inline styles (787) | Status left live-sync item, warning tone | Replaced |
| DockToggle "Terminal Ctrl `" (DockEntryPoints.tsx:22-42) | Title `[B]` plus the Context block | Replaced |
| "Cmd+K palette" hint | none (the command box shows Cmd+K) | Deleted |
| Brand-gradient 1px rule (app.css:370) | Context block fill, plus the prod-only 2px stripe | Replaced |
| Network Policy detail blur 8px (app.css:1892) | Opaque surface, 1px border | Replaced |
| Ad-hoc keydown listeners (App.tsx, useSidebar.ts, DockEntryPoints.tsx, GenericDrawer.tsx, tableUx.ts, ResourceListView.tsx, refreshAll.ts: **7**) | `lib/commands.ts` registry plus one dispatcher | Merged |
| Cmd+K (App.tsx:675-684), Monaco Cmd+K (lib/monaco.tsx:36) | `commandCenter.open`. Monaco's Cmd+K is remapped to the same command. | Merged |
| Cmd+R / Ctrl+R refresh plus sidebar Refresh button (refreshAll.ts) | Registry `workbench.refreshAll`, plus the ViewHeader refresh icon | Merged |
| Table j/k/arrows/Enter/x and "/" (tableUx.ts:126-178), Esc (ResourceListView.tsx:383-393) | Registry, `when: tableFocus`. Enter pins and opens the object tab, Shift+Enter opens the Inspector only. | Merged |
| /terminal route (TerminalPage.tsx:35, navigate(-1)) | Runs `panel.focusTerminal` and replaces the history entry | Kept URL |
| ClusterPicker full-screen catalog-root (ClusterPicker.tsx:352-668) | The Workbench landing: Clusters view plus Clusters tab (Fleet Board, Board/Table) | Moved |
| Picker header: logo, "Clusters - N", Disconnect all, Add kubeconfig, Settings | Band "Clusters 14" with Board/Table, Disconnect all and + Add kubeconfig. Settings is the gear. | Moved |
| Picker summary line, Show/Hide fleet summary | Band counts plus a "Fleet summary" toggle (4 summary blocks) | Moved |
| Picker search field | Clusters view filter (also filters the tab), plus `@` in the QuickPick | Moved |
| Raw "Couldn't load clusters from the engine: ${error.message}" (~411) | InlineBanner: "Kubebay couldn't read your cluster list. Check that the engine is running, then press Retry." Raw text goes to Output > Engine. | Fixed |
| Virtualised resizable cluster table, row icon, rename, hide | Fleet Board Table mode. Row menu: Open, Open in new window, Pin to activity bar, Rename, Change icon, Hide. | Kept |
| Hidden clusters disclosure (591) | Clusters view "Hidden" pane | Moved |
| SettingsDrawerHost (lazy) | Settings tab, the only shape | Deleted |
| Kubeconfig sources Modal (658-664) | Clusters view "Sources" pane. Each source opens as a tab. | Moved; Modal deleted |
| /settings plus SettingsBody long scroll (SettingsBody.tsx:335-449) | Settings tab: a 200px table of contents with search and scroll-spy, the same cards, a new Layout group, and a Keyboard shortcuts page generated from the registry | Restyled |
| Three size stores (sidebar, drawer, dock) | One `kb.workbench.v1` with Reset layout | Merged |

## 6. Interaction model

### Tabs
- **A tab is a URL plus its serialised view state**: namespace override, filter, sort, columns, scroll offset, cursor and sub-tab. It is not a React tree.
- **Opening and pinning**:
  - A single press on an Explorer row, palette hit or row opens a **preview** tab (italic). The next preview replaces it.
  - The tab is **pinned** by a double-click, an edit, Enter, Cmd+click or Cmd+Enter in the QuickPick.
  - Deep links open pinned.
- **Per cluster, per window**:
  - Tab sets belong to each cluster. Switching cluster swaps the set and restores it on return.
  - "Pin across clusters" keeps a tab in every set.
  - Sets are stored per window label, so two windows do not fight.
  - When a cluster has no tabs, the empty sentence reads "No tabs open in staging-gke. Pick something in Explorer."
- **Cap**: 24 tabs per cluster. Opening the 25th closes the least recently used tab that is unpinned and saved, and shows the toast "Closed 'Pods' to stay fast. Reopen with Cmd+Shift+T."
- **Keys**:
  - Close with x, middle-click, or Cmd+W (Alt+W in the browser).
  - Cmd+Shift+T reopens the last closed tab (stack of 20).
  - Ctrl+Tab gives most-recently-used order. Ctrl+PgUp/PgDn moves to the next or previous tab in the focused region.
- **Context menu**: Close, Close others, Close to the right, Close saved, Pin, Pin across clusters, Split right, Save view, Copy link. Drag to reorder.
- **URL**: the URL always shows the focused group's active tab, so Back, Forward and deep links keep working.

### Splits
- Up to **2 editor groups**, side by side (Cmd+\) or stacked (Cmd+Shift+\). Cmd+1 and Cmd+2 focus a group, and each group has its own tab strip.
- Compare opens a diff tab, or the two objects in two groups.
- 2x2 grids and drag-to-split are deferred to a measured slice (S16).

### Namespace
- The global chip scopes every list tab.
- A tab can pin its own namespace through the band chip or the tab menu. Pinned tabs ignore the global chip and show "pinned: <ns>".

### Inspector
- A row press, or a cursor move with j/k, selects the row. The Inspector follows after 120ms of idle.
- The pin icon stops following.
- Enter or a double-click opens the object tab. Shift+Enter opens the Inspector only. Cmd+Shift+Enter promotes the inspected object to a tab.
- `?sel=` is written with replace after 120ms idle or on Enter, and `?pod=` is still read.

### Panel
- Cmd+J toggles the Panel. Ctrl+` opens and focuses Terminal. Cmd+Shift+M opens Problems, Cmd+Shift+L opens Logs for the inspected object, and Cmd+Shift+Y opens Events.
- **Follow mode**: Logs, Events and Terminal follow the Inspector object. The pin freezes them.
- "Move to editor" turns the Panel tab into a full-height editor tab.

### Command center (QuickPick)

| Prefix | Gives |
|---|---|
| none | Go to a page, kind or object in the current scope |
| `>` | Commands (also Cmd+Shift+P) |
| `@` | Clusters |
| `#` | Namespaces (`ns:` also accepted) |
| `:` | Kinds (`:deploy` opens a Deployments tab) |
| `?` | Help on the prefixes |

The list is bounded and virtualised past 50 rows. Object hits come from the existing per-kind search, with its debounce and abort, plus "more". Every row shows its key binding.

### Keyboard (one registry, `lib/commands.ts`)

Each entry has an id, a label, a key, a when-clause (`tableFocus`, `editorFocus`, `panelFocus`, `inspectorFocus`, `monacoFocus`, `xtermFocus`) and a run function. One window keydown listener dispatches through a Map keyed by chord. The registry also feeds the menus, the QuickPick and the Keyboard shortcuts page.

| Keys | Command |
|---|---|
| Cmd+K | Command center |
| Cmd+P | Go to object (preventDefault so print never opens) |
| Cmd+Shift+P | Commands mode |
| Cmd+B / Cmd+Opt+B / Cmd+J | Sidebar / Inspector / Panel |
| Ctrl+` | Focus Terminal |
| Cmd+Shift+M / L / Y | Problems / Logs / Events |
| Cmd+Shift+E / F / G / H | Explorer / Search all clusters / Delivery / Clusters |
| Cmd+\ , Cmd+Shift+\ | Split right, split down |
| Cmd+1, Cmd+2 | Focus group |
| Cmd+W, Cmd+Shift+T, Ctrl+Tab, Ctrl+PgUp/PgDn | Close, reopen, MRU, next/previous |
| Cmd+[ , Cmd+] | Back / Forward (not in monacoFocus, where they indent) |
| Cmd+Opt+1..6 | Cluster blocks |
| Cmd+R / Ctrl+R | Refresh all |
| Cmd+, | Settings |
| Cmd+Shift+Enter | Inspector to tab |
| Cmd+Shift+S | Alias of Split right, for one release |
| F6 / Shift+F6 | Cycle regions |
| j k Enter x / Esc | Table (tableFocus) |

- Zen mode has **no default key**. It is a palette command and a layout preset.
- Inside xterm and Monaco, only Cmd+K, Cmd+J, Ctrl+` and F6 escape. Monaco keeps Cmd+Shift+F, Cmd+\ and the indent keys.
- **Browser build**: Alt+W, Alt+Shift+T and Alt+J replace Cmd+W, Cmd+Shift+T and Cmd+J, and the UI shows them. Back/Forward are hidden.

### Layout menu `[=]`
- **Presets**:
  - Default
  - Triage: Problems open, Inspector on
  - Shell: Panel maximised
  - Review: 2 groups
  - Zen
- Reset layout

## 7. New `@kubebay/ui` primitives

| Primitive | API (props) | Notes |
|---|---|---|
| `Workbench` | `title, activity, sidebar, editor, inspector, panel, status: ReactNode; layout: WorkbenchLayout; onLayout(l)` | Grid only. Writes `--kb-wb-*` variables. No data hooks. |
| `Sash` | ResizeHandle plus `orientation: "vertical" \| "horizontal"`, `edge`, `value, min, max, defaultValue, collapseBelow, onCollapse, onCommit, cssVar, targetRef` | During drag it writes `cssVar` on `targetRef` inside requestAnimationFrame. It commits on pointerup. `role=separator`, `aria-valuenow`, arrows in 16px steps, double-click resets. ResizeHandle becomes a re-export. |
| `ActivityBar`, `ActivityItem`, `ClusterBlock` | `items, activeId, onSelect, onReselect`; item `{id, icon, label, keys, badge?, disabled?, disabledReason?}`; ClusterBlock `{monogram\|icon, state: "live"\|"warm"\|"asleep"\|"switching"\|"error", prod, active, onContextMenu}` | role=toolbar with roving focus. The pip is a class, never an inline style. |
| `ViewHeader` | `title, actions: ToolbarItem[], more?: MenuItem[]` | 28px. |
| `Pane` | CollapsibleSection plus `count, actions, open, onToggle` | Body mounts only while open. |
| `Toolbar` | `items: ToolbarItem[]` (`{id, label, icon?, onRun, group?, primary?}`), `maxVisible?` | Overflows into a Menu, measured once per resize in requestAnimationFrame. |
| `TabStrip` | `tabs: {id, label, icon?, preview?, dirty?, pinned?, prod?}[], activeId, onSelect, onClose, onReorder, menu(tab)` | tablist with arrow keys, middle-click close and an overflow list with a filter. |
| `Tabs` | gains `closable` and `overflow` | The vertical orientation is not needed (R5). |
| `PageHeader variant="band"` | existing props plus `crumbs?: Crumb[]`, `filter?: ReactNode`, `nsOverride?: ReactNode` | 32px. Its crumbs come from the shell `BandProvider`. |
| `StatusBar`, `StatusBarItem` | Item `{tone?: "default"\|"warn"\|"danger"\|"context", fill?: string(token), spinner?, count?, onPress?, tooltip}` | Button or static. `fill` takes a token name only. |
| `Tooltip` | `content, keys?, delay=400` (0 when moving between neighbours) | aria-describedby. Replaces `title=` in the chrome. |
| `QuickPick` | `mode, items, onQuery, onPick, scope` | Anchored, virtualised past 50 rows, no scrim. |
| `Tree` (S16 only) | `rows: FlatRow[], expanded, onToggle` | role=tree, type-ahead. Built only if S5 measures a cost. |
| `NotificationCenter`, `Toast` | `items, onAction, onDismiss` | At most 3 toasts. Errors stay until dismissed, info toasts go after 6s. |
| Icons (about 30) | existing stroke style | delivery, flux, rollout, workflows, events, cost, karpenter, keda, security, history, map, logs, ports, problems, output, split, close, maximise, restore, chevrons, more, back, forward, three layout toggles, pin, bell, home, copy |

New tokens go into all 14 theme blocks and must pass contrast (4.5:1, and 7:1 in the HC themes). The tokens are:
- `--kb-h-title`
- `--kb-wb-side`, `--kb-wb-insp`, `--kb-wb-panel`
- `--kb-prod-stripe`
- `--kb-context-fg`
- `--kb-activity-indicator`
- `--kb-scrim`
- `--kb-radius-tile: 0`
- `--kb-radius-float: 6px`

Cluster colours sit in the Context block with a contrast-checked foreground: the code picks `--kb-context-fg` light or dark per colour, and a test proves 4.5:1 for every palette colour.

## 8. Performance budget (FIRST RULE)

| # | Rule | How the region stays cheap |
|---|---|---|
| P1 | The chrome paints before data | The title bar, activity bar, view headers and status bar use static config and localStorage. Lazy routes stay lazy. The entry chunk grows by at most 8 KB gzip, and first paint regresses by at most 5% against v0.8.7. |
| P2 | Only visible tabs mount | At most 2 routes (one per group). Hidden tabs are a URL plus serialised state. |
| P3 | No new stream eviction | An unmounted tab detaches its watch as today (useResourceStream.ts:234). Its rows stay in the existing 50,000-row LRU streamCache, so switching back paints from cache with no flash. **No 30s timer.** |
| P4 | Resizing does not re-render React | Sash writes a CSS variable in requestAnimationFrame and commits on pointerup. Regions use `contain: layout paint`. |
| P5 | No blur, shadow or animation on docked chrome | The 3 blurs (app.css:1494, app.css:1892, styles.css:1090), the drawer shadow and the slide-in go. A guard greps app.css and styles.css for `backdrop-filter`. |
| P6 | One cluster summary, narrow selectors | The blocks, chip and status bar each subscribe to their own slice. An unchanged poll gives 0 re-renders. |
| P7 | Badges never fetch | Counts show only for kinds whose rows are in the cache. Problems comes from IssueNotifier, ports from the ports store, and the stream count from useResourceStream refs. Kinds with nothing cached show no badge. |
| P8 | Explorer is cheap | Pane bodies mount only while open, with a 40 cap per CRD folder. A virtualised Tree comes only if measured (S16). |
| P9 | Inspector is debounced | 120ms trailing. Summary comes from the cached row. Other facets are lazy, with a timeout and abort on cursor change. |
| P10 | Owned processes are bounded | At most 6 terminal sessions, each closed on End, tab close, disconnect or window close. The YAML budget is 2M chars across all tabs. Log buffers hold 5,000 lines and events 2,000. Events stream only while visible. |
| P11 | The QuickPick is bounded | About 300 static items fuzzy-matched synchronously. Object search keeps its debounce and abort. |
| P12 | One keydown listener | A Map lookup replaces 7 listeners. |

**Measured budgets.** They go in `WorkbenchScale.test.ts` plus `scripts/perf-budgets.mjs`, on the 2,000-pod fixture:

| Measurement | Budget |
|---|---|
| Status bar and cluster blocks over 100 unchanged poll ticks | 0 re-renders |
| 60 Sash pointermove events | 0 React commits |
| Switching between 2 cached tabs with 24 open | Commit under 16ms, p95 first frame under 50ms |
| Restoring 24 saved tabs | 1 route mounted, 1 stream attached |
| Inspector follow, j held through 2,000 rows | No frame over 16ms, 0 fetches unless a non-Summary facet is open |
| Cursor move | Commits only the Inspector and 2 rows |
| QuickPick filter over 300 items | Under 2ms per keystroke |
| Mount and close 100 tabs | Heap flat within 5% |
| Layout math at 980, 1280, 1320 and 1920 wide, and 620 and 800 tall | Editor at least 420px, at least 10 rows at 1280x800 with the Panel open |

## 9. Accessibility
- Landmarks: banner (title bar), navigation (activity bar and Explorer), main (editor), complementary (Inspector), region "Panel", contentinfo (status bar).
- The activity bar is a toolbar with roving focus. Tab strips follow the tablist pattern with arrow keys. Each Sash is a separator with aria-valuenow and arrow keys.
- Cluster blocks carry an aria-label such as "prod-eks-1, production, live". State never relies on colour alone: the pip shape and the PROD text carry it too.
- Tooltips use aria-describedby and the shared delay.
- Focus is visible on every region (1px accent edge) and every control. F6 cycles regions.
- The Context block, prod stripe, pips and badges pass contrast in all 14 themes, including 7:1 in HC.

## 10. Errors
- Each region, tab, Panel tab and Inspector facet has its own ErrorBoundary. It shows a plain sentence and one action, such as "This tab stopped working. Reload tab." Details go to Output > Kubebay.
- A forbidden view shows "You don't have access to list Secrets in payments. Ask an admin for get/list on secrets." It never shows a 403 string.
- A corrupt or old `kb.workbench.v1` falls back to the defaults, never throws, and writes one line to Output.

## 11. Debate rulings

At least these disagreements were raised. Each one is resolved here.

- **R1. Where clusters live.**
  - The positions were: C0, 5 avatars at the top of the activity bar. C1, a separate always-on 44px fleet rail. C2, a stack at the bottom of the activity bar.
  - **Ruling**: one 48px activity bar, with cluster blocks styled as in C1 (square, pip, prod edge) in the **top** group under the Fleet block. Views go in the middle.
  - Why: C1's second rail costs 44px at 980px wide. C2 buried the most frequent cross-context action. Cmd+Opt+1..6 was chosen over Ctrl+1..9, which clashes with Linux and Windows workspace keys.
- **R2. Explorer navigation.**
  - The positions were: C1's periodic-table tile pad with one section mounted, against one tree in C0 and C2.
  - **Ruling**: one Explorer of collapsible panes, all groups visible.
  - Why: two-letter C-glyph tiles (Ac, Cl, Cr, Ct, Cf) are hard to find, and each section change costs an extra press.
  - The tile idea survives as the **Block overview** (Overview tab) and the **Fleet Board**. A virtualised Tree is built only if S5 measures a sidebar cost (from C2).
- **R3. Stream release for hidden tabs.**
  - C0 wanted a 30s refcount release.
  - **Ruling**: dropped. streamCache has no refcount or TTL, and a TTL brings back the skeleton flash the cache was built to stop. Hidden tabs unmount and detach as today, and their rows stay in the existing LRU.
- **R4. Selection storage.**
  - The positions were: C2, `?sel=` on every move. C0 and C1, a store.
  - **Ruling**: a store per tab drives the Inspector, and `?sel=` is written with replace after 120ms idle or on Enter. Writing on every move would re-render every location consumer at key-repeat speed. `?pod=` stays as an alias.
- **R5. Where pod facets live.**
  - The positions were: C0, split across 3 regions. C2, icon-only vertical facet tabs that duplicate Logs and Shell. C1, a summary-only Inspector.
  - **Ruling**: the Inspector lists **every** facet as a labelled horizontal tab row, so there is one place to look. Logs, Events and Shell are launchers into the Panel, so there is one live stream and one xterm mount policy. No vertical Tabs primitive is needed.
- **R6. Badges.**
  - The positions were: C0 and C1 showed counts on every group and tile.
  - **Ruling**: counts only for kinds already cached. `kindCounts.ts` is a client reducer over 6 kinds, not an endpoint, so other groups show no number. The mocks show that.
- **R7. Inspector size and the narrow-window rule.**
  - The positions were: C2, 520px full height. C1, 420px plus a 28px strip.
  - **Ruling**: 380px default, docked above the Panel, overlaying below 1180px wide, and an editor minimum of 420px.
  - The **Panel spans the editor and Inspector** (taken from C1's Deck), so xterm stays wide enough for `kubectl get pods -o wide`.
- **R8. Vertical chrome.**
  - The positions were: C0, tabs 36 + breadcrumb 24 + toolbar 32. C2, a 40px band plus the page toolbar.
  - **Ruling**: one **32px band** that holds the breadcrumb, count, live pill, filter, namespace override and actions with overflow. The Panel default is min(280, 35% of height) and it collapses first below 700px of height.
  - The band is C2's single-component lever, but with an explicit shell `BandProvider` for the crumbs, because `@kubebay/ui` depends only on React. The 29 PageHeader users fold their toolbars into `actions`.
- **R9. Splits and the tab cap.**
  - The positions were: C0, 4 groups and 30 tabs. C1, 4 bays and 12 tabs each. C2, URL-only tabs.
  - **Ruling**: 2 groups for now, 24 tabs per cluster with LRU, and a tab is a URL plus serialised view state (C2's cheapness with C1's remembered scope). 2x2 grids wait for a measured slice.
- **R10. Namespace scope.**
  - The positions were: C2, global only. C1, global plus a per-tab override.
  - **Ruling**: global chip plus the per-tab override chip. Without it, two tabs cannot hold different namespaces.
- **R11. Cmd+W and Zen.**
  - **Ruling**: rebuild the native File menu with Close Window on Shift+Cmd+W, close the window when the last tab closes, and use Alt+W in the browser (from C2).
  - Zen loses Cmd+Shift+Z, which is Redo in Monaco and in inputs, and becomes palette-only.
  - Ctrl+` keeps its current "open and focus Terminal" meaning, not C1's hide toggle. Cmd+P is Go to object with preventDefault, not C1's pin. C1's Pins feature is dropped because Favorites and Pin inspector cover it. Cmd+Shift+F is global search, not "maximise bay".
- **R12. Flag or no flag.**
  - C1 wanted a flag.
  - **Ruling**: no flag, and small slices (from C2). A flag doubles the smoke and guard matrix, and CLAUDE.md ships every commit.
  - "Classic layout" is rejected for the same reason.
- **R13. Splitter.**
  - **Ruling**: Sash is the existing `ResizeHandle` plus `orientation`, not a second splitter, so `shellAdoption` keeps one rule.
- **R14. Containment.**
  - **Ruling**: `contain: layout paint`, not `strict`, because strict would collapse the auto-height rows.
- **R15. Brand line.**
  - C2 wanted to keep the brand-gradient rule.
  - **Ruling**: replaced by the Context block fill and the prod-only 2px stripe (from C0 and C1). That is the strongest "you are on prod" signal.
- **R16. Terminal sessions.**
  - The positions were: C0, 8 sessions. C1, 6.
  - **Ruling**: 6, because each is a PTY plus a WebSocket. The cap is raised only with a measured test.

## 12. Slices

Every slice:
- is TDD first (a failing test committed first)
- updates `website/src/content/docs` and `help.ts` and PageHelp in the same PR, naming controls as the UI labels them
- keeps `shellAdoption`, `themeTokens` and `themeContrast` green
- adds new tokens to all 14 themes
- re-syncs the design-system artifact
- goes through the full `make build`, sidecar copy, `pnpm tauri build` and copy to /Applications, then a screenshot smoke test at 1320x850 **and** 980x620
- records its measured number in the commit and the CHANGELOG

### S1. Context status bar, prod stripe, no blur (ships alone, visibly changes the app)
- **Scope**:
  - `StatusBar` and `StatusBarItem` in @kubebay/ui.
  - The status bar is rebuilt with:
    - the Context block (cluster colour fill, cluster and namespace, danger tone in production)
    - version
    - live sync, which replaces the inline absolute "WS reconnecting"
    - problems count
    - ports count
    - MCP (McpChip moves here)
    - engine
  - The 2px prod stripe goes on the top edge.
  - The brand gradient rule goes.
  - The 3 backdrop-filters go, with the guard.
  - The ClusterPicker raw error is fixed.
  - `useClustersSummary` selectors arrive.
- **Files**:
  - `packages/ui/src/statusbar.tsx` (new), `packages/ui/src/tokens.css`, `packages/ui/src/styles.css`
  - `apps/shell/src/App.tsx` (status 780-796), `app.css` (370, 1494, 1892)
  - `lib/useClustersSummary.ts` (new), `pages/ClusterPicker.tsx`
- **Tests first**:
  - `statusbar.test.tsx` (tones, button vs static)
  - `StatusBarScale.test.ts` (0 re-renders over 100 unchanged ticks)
  - `themeTokens` (no backdrop-filter, `--kb-prod-stripe` and `--kb-context-fg` in 14 themes)
  - `themeContrast` (Context foreground across every cluster colour)
  - a ClusterPicker test proving no raw message text, with the raw text in Output
- **Docs**: `interface.md` (Status bar section), `connect-clusters.md` (error text), `troubleshooting.md`.

### S2. Command registry and complete palette
- **Scope**:
  - `lib/commands.ts` with when-clauses, and one listener replacing the 7.
  - Cmd+Shift+Enter is wired.
  - The palette `>` mode arrives.
  - The static palette items are generated from the route table (missing pages appear).
  - The Overview link is fixed.
  - Monaco Cmd+K is remapped.
- **Files**: `lib/commands.ts`, `App.tsx`, `useSidebar.ts`, `DockEntryPoints.tsx`, `GenericDrawer.tsx`, `tableUx.ts`, `ResourceListView.tsx`, `refreshAll.ts`, `Palette.tsx`, `lib/monaco.tsx`, `lib/routes.ts` (new).
- **Tests first**:
  - registry dispatch and conflicts
  - xterm and Monaco passthrough
  - one-listener count
  - every route has a palette item
  - Overview goes to /workloads-overview
- **Docs**: `interface.md` (Keyboard, Command palette).

### S3. Notification centre
- **Scope**: the bell, toasts and NotificationCenter. UpdateBanner and WhatsNew stop pushing content down.
- **Files**: `packages/ui/src/notify.tsx`, `App.tsx:715-716`, `ClusterPicker.tsx`.
- **Tests first**:
  - update and what's-new arrive as notifications
  - no layout shift
  - at most 3 toasts
  - errors are sticky
- **Docs**: `interface.md`, `install.md` (updates).

### S4. Title bar
- **Scope**:
  - Tauri overlay title bar on macOS (cfg target_os), plus the drag capability.
  - Back and Forward, the Context chip, the namespace chip, the command box, `+` and the toggles.
  - Removed from the sidebar: the brand block, the Clusters link, Disconnect and the Cmd+K hint.
- **Files**: `desktop/src-tauri/src/main.rs`, `tauri.conf.json`, capabilities, `components/TitleBar.tsx`, `App.tsx`.
- **Tests first**:
  - no interactive element carries `data-tauri-drag-region`
  - the browser build hides the inset and Back/Forward
  - the chip menu has Disconnect
  - the cross-compile check for all 3 OSes
- **Docs**: `interface.md`, `connect-clusters.md`.

### S5. Activity bar and view containers
- **Scope**:
  - `ActivityBar`, `ClusterBlock`, `ViewHeader`, `Pane` and `Tooltip`.
  - ClusterStrip is replaced.
  - Tools are split into the views.
  - The duplicate Overview and the Tools label are removed.
  - `--kb-rail-w` goes to 48.
  - Cached-only counts.
  - Explorer render cost is measured.
- **Files**: `packages/ui/src/activity.tsx`, `App.tsx` (128-560), `Favorites.tsx`, `SavedViews.tsx`, `clusterStripState.ts`.
- **Tests first**:
  - roving focus
  - a second press collapses the view
  - badges never fetch (a spy on queries)
  - Rollouts is gated on its CRD
  - Explorer render under 8ms
- **Docs**: `interface.md`, plus every Tools page that mentions "Tools" (helm, argocd, flux, rbac, vulnerabilities and others).

### S6. Workbench grid, store and Sash
- **Scope**:
  - `<Workbench>` and `kb.workbench.v1`.
  - The 3 old keys are migrated once.
  - `Sash` = ResizeHandle plus orientation.
  - Reset layout, Cmd+J and F6.
  - The narrow-window rules arrive.
- **Files**: `packages/ui/src/workbench.tsx`, `resize.tsx`, `lib/workbench-store.ts`, `app.css:63-80`, `terminalDock.ts`.
- **Tests first**:
  - migration
  - corrupt-store fallback
  - 0 commits over 60 pointermoves
  - layout math at 980, 1280 and 1920
- **Docs**: `interface.md` (Layout).

### S7. The band
- **Scope**:
  - `PageHeader variant="band"`, `Toolbar` and the shell `BandProvider` crumbs.
  - The 29 pages fold their toolbars into `actions`.
  - WorkloadTabBar, the FAB and the 6 per-page NamespaceFilters are removed.
- **Files**: `shell.tsx:390`, `lib/band.tsx`, `Workloads.tsx`, `ResourceTable.tsx`, the Helm, Rollouts, NetworkPolicy and Vulnerabilities pages.
- **Tests first**:
  - crumbs for each route kind
  - a regression test for each of the 6 pages reading the global namespace
  - cluster-scoped views show the chip disabled
- **Docs**: `resources.md`, `pods.md`, `create-resource.md`, `helm.md`, `network-policy.md`, `vulnerabilities.md`.

### S8. Panel
- **Scope**:
  - TerminalDock becomes the Panel, with Problems, Logs, Events, Terminal (one-row session list), Ports and Output.
  - Raw errors route to Output.
- **Files**: `components/Panel/*`, `TerminalDock.tsx`, `DockEntryPoints.tsx`, `lib/output.ts`.
- **Tests first**:
  - only the active tab mounts
  - Events stream closes on hide
  - Ctrl+` focuses Terminal
  - Output receives raw text
- **Docs**: `terminal.md`, `issues.md`, `port-forwarding.md`, `troubleshooting.md`.

### S9. Docked Inspector
- **Scope**:
  - The Drawer gets a docked mode in the grid, with the overlay used below 1180px.
  - `selection-store` with `?sel=` and the 120ms debounce.
  - The facet row arrives, with Logs, Events and Shell as Panel launchers.
  - The actions Toolbar.
  - The AI and Compare tabs.
  - DrawerInset and the outside-press close go.
- **Files**: `overlays.tsx`, `GenericDrawer.tsx`, `PodPanel.tsx`, `lib/selection-store.ts`, `ResourceTable.tsx`, `Workloads.tsx`.
- **Tests first**:
  - a cursor move commits only the Inspector and 2 rows
  - holding j gives 0 fetches
  - `?pod=` alias
  - a forbidden facet shows a sentence
- **Docs**: `resource-details.md`, `pods.md`, `ai-triage.md`, `ai-assistants.md`.

### S10. Object tab
- **Scope**: `/detail` becomes the full object view, and Cmd+Shift+Enter and Enter open it.
- **Files**: `pages/ResourceDetail.tsx`.
- **Tests first**: a pod deep link renders the object tab with no redirect.
- **Docs**: `resource-details.md`.

### S11. Editor tabs
- **Scope**:
  - `TabStrip`, with preview and pin, per-cluster and per-window sets, the 24 LRU cap, reopen, MRU and the context menu.
  - The native File menu is rebuilt (Shift+Cmd+W). Alt keys in the browser.
- **Files**: `packages/ui/src/tabstrip.tsx`, `lib/workbench-store.ts`, `main.rs`.
- **Tests first**:
  - restoring 24 tabs mounts 1 route
  - the LRU toast
  - Cmd+W closes the tab, not the window
  - the 100-tab heap leak test
- **Docs**: `interface.md` (Tabs).

### S12. YAML tabs, Compare and Split
- **Scope**:
  - YAML editors become editor tabs, with the 2M budget shared.
  - The Compare diff tab.
  - 2 groups (Cmd+\).
  - The Cmd+Shift+S alias.
- **Tests first**: the budget spans all tabs, and the dirty dot.
- **Docs**: `create-resource.md`, `resource-details.md`.

### S13. Sessions and follow mode
- **Scope**: up to 6 terminal sessions in the side list, the multi-pod Logs list, follow and pin, and Move to editor.
- **Tests first**: the cap, Close on disconnect and window close, and follow switching with a debounce.
- **Docs**: `terminal.md`, `pods.md`.

### S14. Clusters page and Settings in the frame
- **Scope**:
  - The Clusters view (Connected, All, Hidden, Sources).
  - The Fleet Board with Board/Table and arrow-key blocks.
  - The Sources modal and SettingsDrawerHost are removed.
  - The Settings tab gets its table of contents, search, scroll-spy, Layout group and a generated Keyboard shortcuts page.
  - The overlay gets Cancel.
- **Files**: `ClusterPicker.tsx`, `SettingsBody.tsx`, `KubeconfigSources`.
- **Tests first**:
  - the landing does not mount cluster-scoped hooks
  - landing paint does not regress
  - Enter connects
- **Docs**: `connect-clusters.md`, `settings.md`.

### S15. Block overview
- **Scope**: the Overview tab as a square tile grid with a number and sparkline. A press opens the drill-down as a preview tab. It reads only cached data.
- **Docs**: `workloads-overview.md`.

### S16. Measured extras (optional)
- **Scope**: a virtualised `Tree` with a "By namespace" mode, 2x2 groups, drag-to-split, Panel on the right, and window controls drawn by Kubebay on Windows and Linux. Each ships only if its scale test passes and, for window controls, a native-feel review passes.

## 13. Risks
- **Muscle memory and docs churn.** Mitigation: a one-time "What changed" notification, old keys kept as aliases for one release, and the docs.test and help.test gates.
- **Platform title bars.** Mitigation: overlay on macOS only, drag only on spacers, and cross-compile CI.
- **Key conflicts.** Mitigation: a registry test for every focus context, browser Alt keys, and preventDefault on Cmd+P.
- **Looking like a copy of an IDE.** Identity comes from the Context block, prod stripe, cluster blocks, workspaces, follow mode, Block overview and Fleet Board, plus our own icons and 14 themes. No IDE assets are copied.
- **Scope.** Kept down by 16 small slices with no flag. The band variant and the docked Drawer are the two levers. If either misses its budget, that slice is redesigned.
