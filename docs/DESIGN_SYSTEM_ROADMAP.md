# Design system roadmap

The follow-up work from the design-system audit (September 2026), in the order
it should land. Each phase is one PR; each item is one commit with its test
first. Tick an item when its PR merges.

## Phase 1: theme correctness and accessibility (bugs users see today)

- [ ] **No theme flash on launch.** `index.html` hard-codes `data-theme="dusk"`
      and a dark `theme-color`, so light-theme users see a dark frame until the
      bundle runs. An inline boot script resolves the saved theme before paint.
- [ ] **"System" follows the OS contrast setting.** `prefers-contrast: more`
      picks Dusk HC or Dawn HC instead of Dusk or Dawn.
- [ ] **Control borders reach 3:1 (WCAG 1.4.11).** New `--kb-border-control`
      token in all 12 themes, used by inputs, selects and ghost buttons.
      Before: 1.44–1.79:1 in the ten non-HC themes.
- [ ] **Pending is not Warning.** `--kb-status-pending` equals
      `--kb-status-warn` in 11 of 12 themes; pending takes the info hue.
- [ ] **Forced colours.** A `forced-colors: active` block so buttons, inputs,
      pills and focus rings stay visible in Windows High Contrast.

## Phase 2: themed surfaces that ignore the theme

- [ ] Monaco uses `hc-black`/`hc-light` in the HC themes.
- [ ] Chart tokens `--kb-chart-1…5` in all 12 themes; `PodGraphs` and the
      Topology status dots read them instead of hex literals.
- [ ] Contrast test covers status colours on raised and inset grounds and the
      chart series.

## Phase 3: missing components (the biggest adoption gap)

- [ ] `Drawer` / `Modal` (backdrop, header, close, focus trap, Escape), then
      migrate GenericDrawer, EventsDrawer, ClusterDetailDrawer, HelmCharts,
      ClusterIconPicker, PodPanel.
- [ ] `IconButton` for close, back, star and row-menu buttons; migrate the
      51 hand-written `<button>` elements.
- [ ] `Chip` and `SegmentedControl`; migrate `ns-chip`, `settings-chip`,
      `np-status-chip`, the Settings theme cards.
- [ ] `Badge` tones `warn`, `info`, `neutral`; migrate `crd-badge` and
      `events-type-badge`.
- [ ] Layout primitives (`Stack`, `Row`) to replace the 383 inline
      `style={{}}` blocks, starting with Settings and KedaWizard.

## Phase 4: scale hygiene and cleanup

- [ ] `--kb-z-*` z-index scale (today: 11 ad-hoc values from 0 to 201).
- [ ] Replace the remaining literal font sizes (20), radii (19) and
      transition durations (23) in `app.css` with tokens.
- [ ] Delete the 36 unused `app.css` classes (old `cp-*` ClusterPicker set and
      others) and the unrouted `Home.tsx`.
- [ ] Move the reduced-motion rule into `@kubebay/ui`.
- [ ] Guard tests for hand-written `<button>`, raw `px` font sizes and new
      overlay implementations.

## Phase 5: brand consistency

- [ ] Favicon gradient matches `KubebayMark` (`#22d3ee → #41c98e`).
- [ ] The Astro website imports `tokens.css` instead of its own 40 variables.
- [ ] Tauri window background matches the resolved theme.
- [ ] Re-sync the design system artifact after each phase merges.
