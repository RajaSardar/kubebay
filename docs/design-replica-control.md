# Design: a better replica count control

Status: proposal, design only. Owner ask: replace the `−5 − [n] + +5` row with a scrollbar or popup.

## Today (v0.8.5)

- `web/apps/shell/src/components/ReplicaStepper.tsx`: five controls (−5, −, number box, +, +5)
  and an "Unsaved" badge. Used by `ActionsBar.tsx` (drawer, next to an "Apply scale" button that
  turns primary when the count differs) and `WorkloadActionDialog.tsx` (row menu Scale dialog,
  which also renders `BlastRadiusPreview` from `lib/blastRadius.ts`).
- In the drawer the row is crowded: stepper (5 buttons + badge) + Apply scale + Restart + more.
- `@kubebay/ui` has NO Slider and NO Popover. It has `SegmentedControl`, `TextField`, `Select`,
  `Button`, `IconButton`, `Badge`, `Kbd`, `ContextMenu` (portal to body, Escape and outside-click
  close, viewport clamp, but it is a menu of items, not a panel with inputs) and `Dialog`
  (overlays.tsx). Anything new must be added there (First design rule), tokens only, with
  the guard tests (`shellAdoption`, `themeTokens`, `themeContrast`) green.

## Constraints that every option must meet

1. First Rule: instant (no network on drag, no work beyond a state set), no layout shift
   (fixed-width number, popover is a portal, nothing reflows the row), no jank while dragging
   (one state update per animation frame, no re-render of the table or drawer body, blast-radius
   recompute is O(1) on the already-loaded object), no error string.
2. Keyboard and touch: arrows, PageUp/PageDown, Home/End, 44px touch targets.
3. The change is local until Apply: Unsaved state, Reset to N, confirmation, `restartGuard`,
   audit and the GitOps owner warning stay exactly as they are. The control only edits a draft.
4. Scale-down and scale-to-0 keep showing `BlastRadiusPreview` (dialog) and keep the existing
   confirmation; the control never applies on release.
5. HPA/KEDA-managed: show a note ("An HPA manages this workload and will override the count",
   link to it) and keep the control usable, since a manual scale is legal but temporary.
6. Docs rule: the docs page and the ⓘ help entry change in the same PR.

## Options
### (a) Slider + number box + live label
`<input type="range">` styled by tokens, number box beside it, label "18 → 24 (+6)".
- Pros: direct manipulation, one glance shows relative position, native keyboard and touch.
- Cons: a linear range is bad at both ends: 0 to 200 makes 1 vs 2 a one-pixel difference, and
  the true max is unbounded. Needs a non-linear scale and a "max" rule. It is wide (about
  240px), so it makes the cramped drawer row worse unless hidden in a popover.
  Dragging produces many intermediate values, which is harmless as nothing applies until Apply.
### (b) Popover from a single "Scale: 18 ▾" button: presets + slider + exact input
The row holds one button. It opens a panel (portal, anchored under the button, Escape and
outside click close, focus moves in and returns to the button).
Panel: exact number input, slider, preset chips (0, 1, 2, 3, 5, 10, ½, 2×, Current), a line
"18 → 24 (+6)", HPA note, then "Reset to 18" and "Apply scale".
- Pros: fixes the cluttered row (one button, fixed width, no shift), room for every helper,
  presets give one-click jumps, slider gives coarse reach, input gives exactness.
  The same panel works in the drawer and the Scale dialog (inline, no popover, inside the dialog).
- Cons: needs a new Popover primitive (focus management, collision flip, Esc), one more click to
  start. Most code and most tests of the four.
### (c) Stepper with press-and-hold acceleration
Keep − and +, hold repeats: 1/s, then 5/s, then 20/s.
- Pros: tiny change, no new primitive, familiar.
- Cons: still plus and minus (the thing the owner dislikes), slow for big jumps, timers on hold
  (must clear on blur, pointercancel, unmount), and a poor fit for touch and screen readers.
  Does not solve the cluttered row.
### (d) Segmented preset row
`SegmentedControl` of 0 | 1 | 2 | 3 | 5 | 10 plus Custom.
- Pros: one click, zero new primitives, great for small counts.
- Cons: 6 to 8 segments is wider than the stepper it replaces, useless for 18 → 24,
  presets cannot adapt to the current value without the row changing width (layout shift).
### (e) Option (b) with a log-ish slider scale and chips relative to the current count
This is the recommendation (see "Scale mapping").

## Recommendation: (e), the popover

The row becomes `[Scale: 18 ▾] [Restart] ...`. When the draft differs the trigger reads
`Scale: 18 → 24 ▾` with the "Unsaved" badge inside the panel and a primary "Apply scale" button
(also at the foot of the panel, plus still on the row so one click applies once chosen).
In the Scale dialog the same body renders inline (no popover) above the blast-radius preview.
### Panel layout (fixed 280px wide, so nothing shifts)
1. Number input (role spinbutton, type=number, inputMode=numeric, min 0, no upper cap) with the
   live label "18 → 24 (+6)" or "No change".
2. Slider (`role="slider"`, aria-valuemin 0, aria-valuemax = slider max, aria-valuenow, aria-valuetext
   "24 replicas, 6 more than now").
3. Chips: 0, 1, 2, 3, 5, 10, Half, 2×, Current. Chips that equal the draft show pressed;
   Half and 2× are disabled when the result equals the current or rounds to the same value;
   0 carries the danger tone.
4. Notes (only when they apply): HPA/KEDA note with a link to the HPA; StatefulSet note
   "Scaling down removes the highest ordinals first (web-5, web-4, ...)"; scale-to-0 warning.
5. Footer: "Reset to 18" (ghost, only when dirty) and "Apply scale" (primary only when dirty).
### Scale mapping
- Slider max = max(10, 3 × current), rounded up to a "nice" value (10, 20, 30, 50, 100, 200 ...).
- Position to value is piecewise: the first 40% of the track covers 0..10 one by one, the rest
  covers 10..max with growing steps (1, 2, 5, 10 by magnitude). The curve is a pure function
  `replicaFromPosition` / `positionFromReplica`, monotonic and round-trip tested.
- The number box and chips can exceed the slider max; then the thumb pins to the right end
  and the label still shows the real value. The slider never changes the max while dragging
  (max is computed from the live count, not the draft), so the track does not jump.
- A live count change while open updates "now", not the draft.
### Keyboard and touch
- Slider: Left/Down -1, Right/Up +1, PageUp/PageDown +10 (or one tick of the current band),
  Home 0, End slider max; Shift+arrows +10 stays as in today's box.
- Trigger opens on Enter/Space/ArrowDown, focus goes to the number input, Escape closes and returns
  focus to the trigger, Enter in the input applies only when dirty (same path as the button).
- Touch: 44px chips and a 28px thumb with a larger hit area, `touch-action: pan-y` on the track so
  scrolling the drawer is not hijacked, pointer capture while dragging.
- Drag uses `requestAnimationFrame` to coalesce, only the panel re-renders (draft lives in the
  panel, committed upward on change through the existing `onChange`).
### Safety
- Drag, chip or typing only changes the draft. Apply is the only write; the existing confirmation
  and `restartGuard` for scale-to-0 or big drops, audit and GitOps warning run unchanged.
- The blast-radius preview shows in the dialog as today (scale-down or scale-zero) and, in the
  drawer, as a one-line summary in the panel (reuse `computeBlastRadius`, O(1)) so the person
  sees "removes 6 pods, 2 Services lose backends" before pressing Apply.

## Build plan (when approved, TDD, smallest slices)
1. `@kubebay/ui`: `Slider` (range, token colours, rAF drag) and `Popover` (portal, anchor, flip,
   Esc, outside click, focus return). Tests: keyboard, aria, clamping, focus return, no layout
   change, plus the three guard tests.
2. Pure `lib/replicaScale.ts` (max, mapping, presets) with round-trip tests and a 10,000-replica case.
3. `ReplicaControl` replaces `ReplicaStepper` (keep `clampReplicas`), wired in ActionsBar and
   WorkloadActionDialog; HPA lookup from the loaded HPA list, no new request.
4. Docs page, ⓘ help entry, CHANGELOG with the measured drag cost (expect under one frame, 16ms).
5. Build, ship and screenshot the Mac app per the repo rules.

## Challenge round

Verdict: (e) stands as the direction, with the objections below folded in. Where this section
contradicts the text above, this section wins.

### Objections

1. **The draft ownership contradicts itself.** "Draft lives in the panel" conflicts with "Unsaved"
   on the trigger and "Apply scale" on the row: both read the draft while the panel is closed or
   unmounted. Decision: the draft stays where it is today (`edited` state in ActionsBar,
   `replicas` string in WorkloadActionDialog). The panel is a controlled view of it. Closing the
   popover (Escape, outside press) never discards the draft; only "Reset to N" does.
2. **Drawer interplay is the real risk, and the doc missed it.** `Drawer` closes on a mousedown
   on the page behind it and on Escape (`overlays.tsx`, `onPress`, `KEEPS_ESCAPE`). A portal
   popover would be "outside the panel" for the DOM check. React events do bubble through
   portals, so `onMouseDownCapture` marks presses, but Escape must be handled too: the popover
   closes on Escape and calls `preventDefault()` + `stopPropagation()` so the first Escape closes
   the popover, not the drawer. Decision: no body portal inside the drawer. Build `Popover` on the
   `HelpTip` pattern (inline, absolutely positioned, `aria-expanded`, document-level mousedown and
   Escape, focus returns to the trigger) with a flip to open upward or leftward when it would clip
   the drawer edge. Regression tests: Escape closes only the popover; a press inside it does not
   close the drawer; a press behind the drawer closes both.
3. **Do not hand-roll `role="slider"`.** The doc builds a custom ARIA slider with pointer capture
   and rAF coalescing: more code, more bugs, and dragging jank risk. Decision: `Slider` wraps a
   native `<input type="range" min=0 max=1000 step=1>` whose value is the *position*; the pure
   mapping converts to a replica count. Native gives keyboard, touch, `touch-action`, and screen
   reader support, and the browser coalesces input events. Set `aria-valuetext` ("24 replicas, 6
   more than now") on it. PageUp/PageDown and Home/End are native, so drop the bespoke key table.
   The thumb is styled in `styles.css` from `--kb-*` tokens only, with a 44px hit area.
4. **Piecewise-linear mapping must be exact at the seam and stable under keyboard.** Arrow keys on
   a position-based range move a fixed position step, which on the log-ish band skips replica
   values. Decision: keep step=1 on position, resolution 1000, but on `keydown` ArrowLeft/Right
   handle the step ourselves (replica ±1, Shift ±10) and `preventDefault`. Test that every integer
   in 0..max is reachable by keyboard and that `replicaFromPosition(positionFromReplica(n)) === n`
   for all n in 0..max (not a sample), including max = 10,000.
5. **Slider max when the draft exceeds it.** "Thumb pins right" is fine, but the pinned thumb lies
   about the value if the user then nudges the slider by 1 pixel: it would snap the draft down to
   max. Decision: the slider only emits a change on a real `input` event; a pinned thumb that is
   not touched never writes. Test it.
6. **Cramped drawer.** The panel is fixed at 280px, but the drawer's minimum width
   (`DRAWER_MIN_W`) may be near that. Decision: panel width `min(280px, 100% of the drawer - 16px)`,
   chips wrap (not scroll), and a test at the drawer's minimum width.
7. **Duplicate Apply.** Two Apply buttons (row and panel) double the surface for the confirm and
   busy states. Decision: one Apply on the row only. The panel holds the draft controls, "Reset to
   N", and a hint "Press Apply scale to save". Enter in the number input moves focus to the row's
   Apply rather than firing it, so a stray Enter cannot scale a workload.
8. **Blast radius in the drawer.** The doc says one-line summary in the panel; the drawer today has
   no preview at all, so this is new behaviour with new copy. Keep it, but it must be the same
   `computeBlastRadius` output as the dialog, with a test that both render the same text for the
   same input, and it must not be computed per pixel: compute from the draft in `useMemo`.
9. **HPA lookup is unverified.** "From the loaded HPA list, no new request" is an assumption: no
   shell code reads a loaded HPA list for the drawer. Decision: HPA note is a stretch slice. Slice 3
   ships without it unless an existing store already holds HPAs. If it needs a request, it is lazy,
   fires on popover open (not on drawer open), is never blocking, and shows nothing on failure (no
   error string in the First Rule sense).
10. **Presets.** "Half" and "2×" and "Current" next to fixed 0,1,2,3,5,10 produce duplicates (current
    = 2, or 2× = 10). Decision: build the chip list as a pure function that dedupes and sorts
    ascending, always including Current, and caps at 8 chips; test duplicates and current = 0.
11. **Scale to 0 must not be one click away.** A "0" chip next to the slider makes it a one-tap
    draft. It is still only a draft and the existing guard applies, so keep it, but the danger tone
    must not rely on colour alone (label "0 (stop)"), and contrast-tested via the existing guard.
12. **Test plan gap: measure, do not assert.** "Under 16ms drag cost" is not testable in jsdom. Decision:
    unit-test that a drag emits one `onChange` per input event and that the table/drawer body does
    not re-render (render counter on a sibling), and verify the frame cost once by hand in the Mac
    app (Performance trace) and record it in the CHANGELOG. Do not claim a number that was not measured.

### FINAL decision

Ship (e), as a popover on the `HelpTip` pattern (inline, not a body portal), containing: number
input, native-range `Slider` over a non-linear mapping, deduped preset chips, and a live label with
blast-radius summary. Draft stays in the parent; one Apply on the row; HPA note only if data already
exists. The dialog renders the same body inline. Remove `ReplicaStepper` entirely once both call
sites move (keep `clampReplicas`, moved to `lib/replicaScale.ts`).

### Build scope (tests first, in this order; each slice commits green)

1. `web/apps/shell/src/lib/replicaScale.ts` + `lib/__tests__/replicaScale.test.ts`: `sliderMax`,
   `positionFromReplica`, `replicaFromPosition`, `presetChips`, `clampReplicas`. Exhaustive
   round-trip, monotonic, 0 / 1 / 10 / 11 / 10,000 cases, chip dedupe.
2. `web/packages/ui/src/overlays.tsx`: `Popover` (trigger render prop or `label` + `children`,
   `align`, flip, Escape with stopPropagation, outside press, focus return, `aria-expanded` and
   `aria-controls`). Tests: Escape, outside press, focus return, Escape does not close an enclosing
   Drawer, press inside does not close it.
3. `web/packages/ui/src/` `Slider` (native range, `value`, `min`, `max`, `onChange`, `valueText`,
   `label`, `disabled`) + token styling in `styles.css`, and a section in `docs/DESIGN_SYSTEM.md`.
   Tests: aria, keyboard, no write without input, disabled. Guards `shellAdoption`, `themeTokens`,
   `themeContrast` green with a new `--kb-*` token only if needed (all 12 themes).
4. `web/apps/shell/src/components/ReplicaControl.tsx` + test (body, trigger text "Scale: 18 → 24",
   Unsaved, Reset, chips, blast-radius line, no layout change: fixed trigger width via `min-width`,
   `inline` mode for the dialog). Wire into `ActionsBar.tsx` and `WorkloadActionDialog.tsx`; delete
   `ReplicaStepper.tsx` and update its tests. Existing confirmation, `restartGuard`, audit and
   GitOps warning tests must pass unchanged.
5. Docs: the Workloads docs page in `website/src/content/docs/`, the ⓘ entry in `lib/help.ts`,
   CHANGELOG, backlog item 89 marked done; run `cd website && npm test && npm run build`.
6. Vitest + `go test ./...`, `make build`, Mac app ship and screenshot per CLAUDE.md.

Out of scope: HPA editing, a request for HPAs on drawer open, applying on release, any server change.
