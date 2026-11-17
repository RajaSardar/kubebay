# YAML editing in a bottom dock: can we, and how

> Backlog item 51. Researched 2026-11-18 against `main` at v0.7.5. Research only: nothing is built.
>
> **Request:** "give an option to edit in a bottom window if they want, like Lens/Freelens, but in addition to how Kubebay already offers editing."
>
> Claims about Lens and Freelens come from the research already in this repo (`docs/adr/0005-terminal-dock.md`, `docs/PARITY_FRELENS.md`) and from memory of the products. Anything marked **unverified** was not checked against their source or a running copy for this note.

## 1. The question

Kubebay edits YAML in a drawer tab and on a Create Resource page. Lens and Freelens also let you open an editor as a tab in the bottom dock, next to logs and terminals. Should Kubebay add that as a second way in, and how do we do it without breaking the safety work the drawer editor has?

## 2. Short answer

**Yes, and it is cheap if the dock tab hosts the same editor component.** `YamlTab` already takes `cluster, gvr, ns, name` and owns load, dry-run, diff, apply and conflict handling. A dock tab is a second place to mount it. The real work is not the editor but what a dock adds: several editors open at once, edits that outlive the drawer, and closing a tab that holds unsaved text. Kubebay has **no unsaved-change guard anywhere today**, so that must come first.

Recommendation: an opt-in **Edit in dock** action on the drawer's YAML tab (the drawer stays the default), one shared dock with tabs, and a dirty-tab guard built before multiple tabs ship. See sections 6 and 8.

## 3. What Lens and Freelens do

| Behaviour | Lens / Freelens | Confidence |
|---|---|---|
| A bottom dock holds terminal, pod logs, create-resource, edit-resource and install-chart tabs | ADR 0005 records this for Freelens: "the same dock holds pod logs and create, edit and Helm editors"; sessions live in a store keyed by tab id, not in components | From this repo's earlier research |
| Edit opens as a dock tab named after the object | Believed so | **Unverified** against source |
| Editor is Monaco with Save, Save and Close, Cancel | Believed so | **Unverified** |
| Tab is reused when you edit the same object again | Believed so (tab id derived from the object) | **Unverified** |
| Unsaved edits survive navigating and hiding the dock | Follows from the tab store holding the text outside components | Inferred, **unverified** |
| Warns on closing a dirty tab | Not known | **Unverified** |
| Dock has Ctrl+W close, hardcoded heights, restart-and-close quirks | ADR 0005 lists these as rough edges | From this repo's earlier research |
| Conflicts | Believed to be a plain PUT with resourceVersion; a conflict surfaces as an API error | **Unverified** |

Takeaway: the shape to copy is "tabs in a store, hidden is not closed". What to do better are the rough edges the ADR already named, plus unsaved-change safety.

## 4. What Kubebay has today

All paths are under `web/apps/shell/src` unless noted.

**The editor, `components/YamlTab.tsx` (286 lines).** Props: `cluster, gvr, ns, name, gitopsOwner, helmRelease, impactBanner, dangerousChangeCheck`. It owns:
- Loading through `api.getYamlText` (`GET /api/yaml`). Secrets stay masked until **Reveal values**, which the engine audits.
- Monaco through `lib/monaco.tsx` (bundled copy in lazy chunks, so air-gapped installs work), plus a Monaco `DiffEditor`.
- Buttons **Reload**, **Revert** (local only), **Dry-run**, **Apply**, and a `diff view` checkbox. A dry-run shows the server-computed result in the diff.
- Banners: Helm-managed ("the next helm upgrade restores the chart's values"), Argo CD / Flux owner, and an optional "This change looks risky" gate where Apply stays disabled until you type the resource name (used by Karpenter's NodePool editor).
- Its state is component state (`original`, `modified`, `showDiff`, ...). Unmount loses the edit.

**Where it is mounted.** The drawer's YAML tab (`components/GenericDrawer.tsx:196-199`) for generic kinds, nodes and services, and the Karpenter editor via `components/heavy.tsx`. `pages/CreateResource.tsx` (129 lines) is a separate page with its own Monaco editor, a kind picker over `RESOURCE_TEMPLATES`, a **Dry run** checkbox and `POST /api/yaml/create`. A table's "+" button opens it with `?kind=`.

**The engine, `engine/internal/httpapi/yaml.go`.**
- `PUT /api/yaml` (`HandleApplyYAML`). When the request carries `original`, the engine diffs it against the edited text and sends only the **changed fields** as an Update patch (strategic for built-in kinds, merge otherwise; `editpatch.go`). `mode=merge|strategic` is for callers such as KEDA pause and right-sizing.
- **Conflict handling is field-level, not resourceVersion.** It re-reads the live object, diffs `original` against it, and if a field the user changed also changed on the cluster it returns `409 {"error":"changed-since-load","paths":[...]}`. The UI shows **Not applied: these fields changed** with **Reload current version** (`StaleEditError`). Changes to other fields are left alone. `Force` is ignored. The editor strips `resourceVersion`, `managedFields` and `generation` from what it shows, so the user never sees or sends a resourceVersion.
- `dryRun` is supported and the response carries `resultYaml`. Admission-webhook rejections come back as a `PolicyRejectionCard`.
- Every apply is audited (field names only, never values) and runs under the caller's identity (impersonation).
- `POST /api/yaml/create` handles multi-document YAML, with dry-run.

**The dock, ADR 0005.** `components/TerminalDock.tsx` is a bottom `<section>` between the page and the status bar, with a `Splitter` (height kept in `localStorage` as `kb.dock.height`, 120 px minimum). It is **v1: one bound local shell**, no tabs. The shell lives in a module-level session (`lib/shellSession.ts`), not a component, so hiding or navigating doesn't kill it. **Ctrl+`** (`isDockToggle`, `code === "Backquote"`, Ctrl only) toggles it. Drawers end above the open dock and ignore presses in it (`DrawerInset ... keepOpenIn={dockRef}`, `App.tsx:637`). State is in `lib/terminalDock.ts`. The ADR explicitly **rejected "Create, edit and Helm tabs"** for v1, and lists local-shell tabs as later slice 4, gated on engine hardening and a week of use.

**Gaps that matter here.**
1. No unsaved-change guard anywhere (no `beforeunload`, no "discard?" when closing a drawer or tab). Closing the drawer on a dirty YAML tab drops the edit silently.
2. No production confirmation on YAML Apply. `looksProduction` (`lib/localshell.ts`) is used only by the shell today.
3. Editor state is not persisted; Create Resource loses its text on navigation.
4. xterm is kept out of the main chunk by a test. Monaco is lazy too, so a dock tab must not pull it into the main chunk either.

## 5. Design questions

### 5.1 Same component in the dock, or a separate pane?
Reuse `YamlTab`. Its logic (patch-only apply, stale-field refusal, Secret reveal, Helm/GitOps banners, the dangerous-change gate) is exactly what we do not want to fork. The dock tab becomes a host that supplies the props and keeps the state. To survive hiding, state moves out of the component into a store keyed by tab id (the same principle as ADR 0005 decision 3), and `YamlTab` reads `original/modified` from the store when hosted in the dock.

### 5.2 Interaction with drawers
- The drawer stays the quick path. Add **Edit in dock** to its YAML tab. It moves the current edit, including unsaved text, into a dock tab and returns the drawer to Summary.
- The dock and drawer could show the same object. Rule: one live editor per object. If a dock tab for it exists, the drawer's YAML tab shows "Being edited in the dock" with a **Go to tab** button instead of a second editor. This removes the two-editors-one-object conflict class.
- Drawers already end above the dock and ignore presses in it, so the layout work exists.

### 5.3 Multiple tabs
A tab is keyed by `cluster/gvr/ns/name`, so reopening focuses the existing tab. The strip shows kind and name, a dirty dot, and the cluster's production pill. Cap at about 8 tabs (each holds a Monaco model and the loaded text; memory not measured). The terminal becomes one tab among them, which is what ADR 0005 slice 4 anticipated. The two share the tab strip and should build it once.

### 5.4 Unsaved-change safety
- Closing a dirty tab: confirm ("Discard changes to deployment/api?") with **Keep editing** and **Discard**.
- Closing the window or quitting with dirty tabs: confirm. This depends on ADR 0005 later slice 2 (Tauri `CloseRequested` interception, not yet proven). Until then use `beforeunload` for the browser build.
- Switching cluster or a remote disconnect with dirty tabs: tabs stay, marked "cluster not connected", and Apply is disabled until it is back.
- Optional: keep dirty text in `sessionStorage` so a crash or reload offers "Restore unsaved edits". sessionStorage is per window (see `docs/MULTI_WINDOW.md`), the right scope. **Never store revealed Secret values.**

### 5.5 Production-context confirmations
Today a YAML Apply on a production cluster is not confirmed at all. A dock makes it easy to leave an edit open for a long time, so tighten it: when `looksProduction` says the cluster reads like production, Apply asks first (the `ArmedButton` pattern from `DockShell`), and the tab header carries the production pill. The check is a name heuristic only (the dock's own tooltip says so) and the copy must say that. Dry-run stays unconfirmed. Apply this to the drawer editor too, otherwise the dock is the safer path and the drawer the riskier one.

### 5.6 resourceVersion conflicts
Kubebay's field-level check suits a long-lived tab better than a resourceVersion 409: a Deployment's `status` and `replicas` change constantly, and a whole-object resourceVersion would refuse nearly every save after a few minutes. Keep it. What a dock adds is **staleness while the tab sits open**:
- Show "Changed on the cluster since you opened this" proactively. The cheap version: when the tab regains focus, re-fetch and compare with `original`. If different and the tab is clean, refresh silently. If dirty, show a banner with **Show changes** (diff of live vs original) and **Reload**.
- No auto-merge of edits. The engine already refuses overlapping fields; keep that as the authority.
- Object deleted while a tab is open: show "This object no longer exists" and let the user copy the text out.

### 5.7 State persistence
- Dock open state and height: height already persists; open state deliberately does not (ADR 0005 decision 10). Edit tabs follow the same rule: **a relaunch starts with no tabs.** Dirty text is the only thing offered back, via the restore prompt in 5.4.
- Create Resource as a dock tab ("New resource", template picker inside) is a natural later phase and fixes gap 3.

### 5.8 Keyboard shortcuts
- Ctrl+` keeps toggling the dock. Focus goes to the active tab's editor when it is an edit tab (the ADR focuses the shell; generalise to "the active tab").
- Apply: Cmd/Ctrl+S inside the editor (Monaco gets the keys, so bind with `editor.addCommand`, and `preventDefault` in the browser build). Cmd+W stays unbound (ADR 0005 rejected it: in the desktop app it closes the window and the engine).
- Next/previous tab: Ctrl+PageDown / Ctrl+PageUp (not Ctrl+Tab, which browsers own). **Unverified** that Tauri's webview leaves these free; check in the macOS app.
- Monaco shortcuts (Cmd+F, Cmd+/) must not be swallowed by the dock's global handler. `isDockToggle` is Ctrl+` only, so there is no collision.
- Accessibility: the tab strip needs `role="tablist"` with arrow-key movement and a visible focus ring from `@kubebay/ui` (a Tabs-style primitive may be needed; check `docs/DESIGN_SYSTEM.md` first).

## 6. Debate: two alternatives

### Option A: dock tab hosting the same `YamlTab`, opt-in beside the drawer (recommended)
**For.**
- Reuses every safety feature at once; one place to fix bugs.
- Matches what Lens/Freelens users expect and shares the tab strip with the coming terminal tabs.
- Lets people read logs or use the terminal while editing, which a drawer cannot do.
- The "one live editor per object" rule (5.2) keeps it simple.

**Against.**
- Editor state has to move to a store, and ADR 0005 put tabs behind engine hardening, so building edit tabs first pulls forward part of what the ADR deferred.
- Dock height (default min(300 px, 35% of the window)) is small for a 200-line manifest.
- Two entry points mean two sets of docs and tests.

### Option B: a separate editor pane (full-page editor route), no dock
**For.**
- Full width and height for long manifests, and no dependency on dock tabs or terminal hardening.
- A route (`/edit/:cluster/:gvr/:ns/:name`) is deep-linkable and works in new windows (`docs/MULTI_WINDOW.md`).
- Simplest unsaved-change story: one editor per window and a leave-route guard.

**Against.**
- It is not what was asked ("bottom window like Lens/Freelens"). You cannot see the list or logs while editing, which is the point of a dock.
- A new route needs a docs page, help entry and ⓘ (CLAUDE.md docs rule) and adds nav surface.
- Several objects at once needs several windows, not tabs.

### Cross-challenge
- B's strongest point is height. A's answer: a **Maximise** toggle on the dock (fills the content column, keeps the sidebar), with the drawer's wide mode for long files. This holds, but maximise is not in ADR 0005 and needs a design.
- A's strongest point is working in parallel (logs while editing). B's answer is a second window. Rebuttal: a second window is heavy for a quick edit, and new windows open on the cluster picker.
- A's risk is the ADR, which rejected edit tabs. It did so *for v1* to keep the first slice small, and slice 4 is the tabs slice, so this is sequencing, not a contradiction. Link this note from the ADR when the work is scheduled.
- Both options need the dirty-tab guard and the production confirm, so neither is a reason to choose one.

### Recommendation
**Option A, built in the order of section 8**, with a **Maximise** toggle to cover B's height argument. Keep the drawer YAML tab and Create Resource page as the defaults. Do not build B. If a deep link to an editor is wanted later, it falls out of the store keyed by object.

## 7. Risks and open questions
- Whether to pull dock-tab infrastructure ahead of ADR 0005's engine hardening. Edit tabs need none of the exec work (no channel), only the tab strip and the store, so they can ship first and the terminal joins the strip later.
- Two fetch paths for one object (the dock tab and the live informer) can disagree briefly; the focus re-fetch in 5.6 covers it.
- Memory per Monaco model is **not measured**. Measure at 8 tabs of a large CRD before fixing the cap.
- Tauri window-close interception and Ctrl+PageUp/Down: **unverified**.
- Confirm the Lens/Freelens behaviours marked unverified in section 3 before copying any of them.

## 8. Phased plan

Every phase is TDD (test first), uses `@kubebay/ui` only, and updates the user manual in the same PR (`website/src/content/docs/resource-details.md`, `terminal.md`, and `create-resource.md` for phase 4, plus `help.ts` entries).

| Phase | Scope | Gate | Effort |
|---|---|---|---|
| 0 | **Unsaved-change guard in the existing drawer editor**: confirm when closing a dirty YAML tab or drawer; production-name confirm on Apply (`ArmedButton`) with a pill. Useful on its own and a prerequisite. | Component tests for dirty-close and prod-arm; guard tests green | 1.5 days |
| 1 | **Edit tab store and tab strip in the dock**: store keyed by `cluster/gvr/ns/name`, one live editor per object, dirty dot, close guard; terminal stays the first tab. `YamlTab` takes its state from the store when hosted. Monaco stays out of the main chunk (import-graph test, like xterm). | Phase 0; tests for reuse-on-reopen, hide-keeps-text, cluster-drop banner | 4 to 5 days |
| 2 | **Entry points and shortcuts**: **Edit in dock** on the drawer YAML tab, a row action, a ⌘K entry; Cmd/Ctrl+S to apply; tab keys; dock **Maximise**. | Phase 1; keyboard tests; screenshot check in the Mac app | 2 to 3 days |
| 3 | **Staleness and recovery**: focus re-fetch with a "changed since opened" banner and **Show changes**; deleted-object state; `sessionStorage` restore prompt (never revealed Secrets); window-close confirm once Tauri interception is proven. | Phase 1; engine unchanged; tests with a changed live object | 3 days |
| 4 | **New resource tab** (Create Resource in the dock with its template picker; keep the page). | Phase 1 | 2 days |
| 5 | Measure memory at the tab cap, set the cap from data, docs polish. | Phase 3 | 1 day |

Total about 13 to 15 working days (estimated, not measured). Phase 0 alone (1.5 days) closes the real safety gap whether or not the dock ever ships.
