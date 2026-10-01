# Table follow-ups: decision record

Findings #21, #23–#27 of `TABLE_UX_RESEARCH.md`, decided 2026-10-01 after a
three-way debate (product, engineering, accessibility) and a cross-examination
round (CLAUDE.md multi-agent debate rule), then the product owner's choices.

All three agreed the select-all scope is silent and hidden/removed rows stay selected; eng found the
worse bug (selection + pending delete survive a kind switch) — shipped first as #85.

## Rulings on the disagreements

1. Change-tint trigger. ux: visible-value signature (fears Node heartbeats); eng/a11y: resourceVersion.
   Cross-check: node heartbeats moved to Lease objects, but kubelet still rewrites Node status every
   ~5 min (lastHeartbeatTime), bumping resourceVersion — on 200 nodes that is a tint every ~1.5 s.
   Ruling: BOTH, layered. A resourceVersion change marks a row "candidate" (cheap, per key, no object
   diff); the row tints only if its visible-cell signature (sortValue of shown columns) changed.
   Cost is per changed row only. No tint on first sync, resync, virtualiser mount, filter reveal.
2. "Show pods". eng/a11y: client `?q=` filter; ux: server labelSelector + chip.
   Cross-check: the Pods stream is scoped by the global namespace filter (Workloads.tsx useSelected-
   Namespaces); a client filter shows nothing when the workload's namespace is not selected, and
   label tokens need labels on every pod row. useResourceStream already takes labelSelector
   (useResourceStream.ts:39,160). Ruling: ux — `/workloads?ns=…&selector=…&of=Deployment/web`
   streams that namespace with the selector, shows a removable chip, never writes the global store.
   matchExpressions → set-based selector; empty selector → action disabled.
3. Delete confirmation. a11y: in the bar; eng: keep top banner; ux: preview list.
   Ruling: keep the existing banner (GitOps warning, policy-rejection card, tests) — the bar's
   Delete opens it, focus moves to its Cancel, and it gains a preview (first 5 names, "+N more",
   "across K namespaces"). No ArmedButton (auto-disarm fails WCAG 2.2.1).
4. Plain text vs hidden columns. Ruling: plain words match shown columns only; `key:` tokens reach
   any column with a filterKey, shown or not (needed once #21 can hide columns).
5. Column chooser. ux: drag + Alt+arrows; a11y: list with Move up/down, no drag (2.5.7).
   Ruling: a11y for v1 (buttons work for everyone; drag can come later). Lives at the right of the
   toolbar ("Columns"). Name locked first and visible. Reset to default.
6. Owner rename to "Managed by" (ux). Contested with nobody, but a visible wording change → owner's call.
7. Selection across filter changes. ux/a11y: keep + "N hidden by filter" + "Deselect hidden";
   alternative: auto-drop hidden rows. Owner's call (affects what bulk delete does).
8. Sticky. Pin checkbox + Name on the left (kebab is already sticky right). Opaque sticky cells:
   background-color from the row's surface, row-state tint painted as background-image on top,
   accent bar moved to the first cell's inset shadow; forced-colors: Canvas. Width offsets come
   from column-id widths (prerequisite).

Missed by all three: storage-key migration — `kb.sort.*` keys must keep working (sortKey unchanged);
the virtualisation test and guard tests must stay untouched; the design-system artifact needs a
re-sync after the @kubebay/ui PRs (SortHeader pinned, Table pinLead, SelectionBar, ColumnChooser,
CellLink, VisuallyHidden/Announcer, --kb-row-changed in all 12 themes).

## PRs, each independently mergeable, in order
0. #85 selection/pending-delete scope fix (open).
1. Prereq: widths keyed by column id; Name/Namespace/Age as built-in ListColumns; delete concurrency
   cap (8); owner lookup index by key. (refactor; no visible change)
2. #27 sticky checkbox + Name (Table `pinLead`, SortHeader `pinned`).
3. #24 changed-row tint (`TableRow changed`, `--kb-row-changed` ×12 themes, contrast test).
4. #26 SelectionBar + Announcer/VisuallyHidden; scope wording; banner preview; header Delete removed.
5. #25 filter syntax (`parseFilter`, `ListColumn.filterKey`, `labelsOf`, `-` negation, unknown key
   stays text, FieldHint).
6. #21 column chooser (`kb.cols.<sortKey>` = {v:1, order, hidden, widths}).
7. #23 Owner/Managed-by CellLink → /argocd?app= | /flux?name= (pages read the param); "Show pods"
   row action + Pods `?ns&selector&of` chip; NsPill keyboard-operable.

## Product owner's choices (2026-10-01)

- A selection hidden by a filter is kept: the bar says "N hidden by filter" and offers "Deselect hidden".
- "Show pods" opens Pods scoped to the workload (namespace + selector) with a removable chip.
- The Owner column becomes "Managed by" and links to the Argo CD / Flux page.
- The column chooser reorders with Move up / Move down buttons; no drag in v1.
