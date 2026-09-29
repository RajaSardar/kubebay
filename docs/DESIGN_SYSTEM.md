# Kubebay design system

Every pixel of the Kubebay UI comes from one place: the `@kubebay/ui` package in
`web/packages/ui`. The shell (`web/apps/shell`) composes pages from it and never
restyles it. Tests enforce this, so a change that bypasses the system fails CI.

The visual reference (tokens in all eight themes, live component previews, usage
rules) is the Kubebay design system artifact:
https://claude.ai/artifact/J35D45QQ7X6Sgd7mwfRSnF

## Where things live

| What | File | Notes |
|---|---|---|
| Colour, shadow and focus tokens for all 12 themes | `web/packages/ui/src/tokens.css` | `--kb-*` custom properties, one block per `data-theme` |
| Type scale, spacing, radii, motion, layers | `web/packages/ui/src/tokens.css` (`:root`) | `--kb-text-*`, `--kb-space-*`, `--kb-radius-*`, `--kb-dur*`, `--kb-ease*`, `--kb-z-*` |
| Component styles | `web/packages/ui/src/styles.css` | the only CSS for package classes |
| Core components | `web/packages/ui/src/index.tsx` | `Button`, `ArmedButton`, `Card`, `Badge`, `StatusDot`, `Skeleton`, `chartColor()` |
| Shell components | `web/packages/ui/src/shell.tsx` | `StatusPill`/`phaseTone`, `Tabs` (with `trailing` controls), `SegmentedControl`, `IconButton`, `NavItem`/`NavSection`/`navItemClass`, `DisclosureButton`, `ChoiceCard`, `TextField`, `Select`, `Kbd`, `PageHeader`, `ContextMenu` |
| Layout | `web/packages/ui/src/layout.tsx` | `Row`, `Stack` (`gap` on the `--kb-space-*` scale, `align`, `justify`, `wrap`, `as`) |
| Tables and feedback | `web/packages/ui/src/table.tsx` | `DataTable`, `TableWrap` (`busy` refresh bar), `Table`, `SortHeader`, `SelectAllHeader`, `SelectCell`, `TableRow`, `NsPill`, `SkeletonRows`, `SkeletonTable`, `SkeletonLines`, `EmptyState`, `InlineBanner` |
| Loading | `web/packages/ui/src/spinner.tsx`, `icons.tsx` | `Spinner` (the helm `IconLoader` turning, `role="status"`) |
| Overlays | `web/packages/ui/src/overlays.tsx` | `Drawer` (with `embedded` for the full-page view), `Modal` |
| Brand mark | `web/packages/ui/src/brand.tsx` | `KubebayMark`; the gradient is `--kb-brand-cyan` → `--kb-brand-green`, also used by the favicons, app icons and the website's `KubebayMark.astro` |
| Website | `website/src/styles/global.css` | imports `tokens.css` (Dusk); its `--bg`, `--text`, `--accent`… are aliases for `--kb-*` tokens |
| Desktop window | `web/apps/shell/src/lib/nativeWindow.ts`, `desktop/src-tauri/src/window_theme.rs` | the native window's colour and title bar follow the theme |
| Icons | `web/packages/ui/src/icons.tsx` | 18 stroke icons, `currentColor` |
| Reduced motion, forced colours | `web/packages/ui/src/styles.css` | apply to any app using the package |
| Page layout, one-off page styling | `web/apps/shell/src/app.css` | layout only; never a package class |

## Rules

1. **Use the component, not its class name.** Tables, page headers, inputs,
   selects, keycaps, nav links, tabs, status pills, menus, empty states,
   banners, badges and buttons are rendered with their `@kubebay/ui` component.
   Router links take `navItemClass()`. Pick the control by what it does:
   `Tabs` switch the panel below them; `SegmentedControl` picks one value or
   view from a short list in a toolbar or form row; `IconButton` is any
   icon-only button (close, back, row menu, pop-out, star) and always has a
   `label`; `Badge` takes `tone` `ok`, `warn`, `err` or `info` (none is
   neutral). A collapsible group's header is a `DisclosureButton`; one choice
   from a grid of cards (themes) is a `ChoiceCard`. Flex layout is `Row` or
   `Stack`, never an inline `display: flex`; spacing between children is their
   `gap`, not margins. A panel about one resource is a `Drawer` (it closes on Escape,
   except while the user types in a field, the YAML editor or the terminal,
   and hands focus back when it closes); anything that must hold focus until
   dismissed is a `Modal`, which renders into `document.body` so a translucent
   ancestor cannot clip it.
2. **Loading shows the shape of what is coming.** A list or table with no rows
   yet is a `SkeletonTable` under its real headers; rows already on screen
   while the stream re-syncs get `TableWrap busy`; a drawer or pane is
   `SkeletonLines`. Only a wait with no shape to sketch (detecting an
   operator, drawing a graph, connecting to a cluster) takes the `Spinner`
   (`PageLoader` for a whole page), and every loading state says what it is
   waiting for. Never a blank page, a bare "Loading…" or a hand-drawn spinner.
   See `docs/TABLE_UX_RESEARCH.md`.
3. **Every table is the ResourceTable design.** Use `DataTable` for ordinary
   tables (columns, rows, optional sort, selection, row click, `loading`,
   `empty`). Use the primitives (`TableWrap`, `Table`, `SortHeader`,
   `SelectAllHeader`, `SelectCell`, `TableRow`, `NsPill`, `SkeletonRows`) only
   when a table needs virtualisation, column resizing or expandable rows.
   Name cells take `className="mono td-name"`, secondary facts `cell-secondary`,
   namespaces `NsPill`, phases `StatusPill` (with `phaseTone` for pods).
4. **Colours come from tokens.** No hex, `rgb()` or `rgba()` literals in shell
   TSX or `app.css`, and no `var(--kb-x, #fallback)` fallbacks. The only
   exceptions are data: the Settings theme swatches and user-picked cluster
   colours (`ClusterIconPicker.tsx`). Text on a user-picked colour uses
   `avatarLabelColor()`. Chart series take `chartColor(i)` (the theme's
   `--kb-chart-1…5`, each 3:1 on every ground); status dots are `StatusDot`
   (tones `ok`, `warn`, `err`, `pending` or a connection state). Code editors
   take `useMonacoTheme()`, which picks Monaco's high-contrast themes in
   Dawn HC and Dusk HC.
5. **Never restyle a package class from `app.css`.** If a component needs a new
   look, add a prop or variant to the component and its styles to
   `styles.css`. A later `app.css` rule silently overrides the design system;
   that is how ghost and danger buttons drifted before this was enforced.
6. **Every theme must stay readable.** Text reads at 4.5:1 or better on every
   ground in every theme (body and muted text 7:1 in Dawn HC and Dusk HC, also
   on a selected row), status pills and labels on fills reach 4.5:1, and focus
   rings are solid and at least 3:1. Tinted fills (pills, badges, the active
   segment, the active palette item) keep their text at 4.5:1 on every ground
   they can sit on: canvas, surface, raised, inset and a selected row. Ok,
   warn and err stay saturated and at least 25° of hue apart, and muted text
   never takes the accent's hue. Clickable things are never faded to show a
   state; desaturate instead. Adding or changing a colour means updating all
   12 theme blocks; the contrast test computes the ratios from `tokens.css`.
   Token pairs are not the whole story: before a design-system change merges,
   render every component in all 12 themes and measure each text run against
   its real composited background. `node scripts/theme-audit/theme-audit.mjs`
   does this for the token gate, cluster catalog and Settings (text, control
   edges and focus rings) against an offline kubeconfig, after `make build`.
7. **Labels on fills use their on-colour token**: `--kb-accent-fg` on
   `--kb-accent`, `--kb-on-danger` on `--kb-status-err`. Never `#fff`. The
   on-colour tokens are for solid fills only: on a tint such as
   `--kb-accent-subtle`, text takes `--kb-accent` (in Dawn, `--kb-accent-fg`
   is white).
8. **Buttons**: `primary` for the one action a view is for, `ghost` for
   everything else, `danger-ghost` for the first step of a destructive action
   and `danger` (or `ArmedButton`) to confirm it. `Button` defaults to
   `type="button"`; a form's submit button must say `type="submit"`.
9. **Sizes, layers and timing come from the scales.** Font sizes are
   `--kb-text-*` (`--kb-text-icon` for a glyph inside a control or avatar),
   radii `--kb-radius-*` (or `50%` for a circle), and any transition or
   one-shot animation up to 400 ms is `--kb-dur-fast`, `--kb-dur`,
   `--kb-dur-slow` or `--kb-dur-slower`; only long loops (spinners, pulses)
   keep a literal. Anything that floats over the page takes a `--kb-z-*`
   layer (sticky, drawer, dropdown, overlay, palette, modal, popover, lowest
   first); `z-index` 0–3 is only for stacking inside one component. New
   overlays are a `Drawer` or `Modal`, never a hand-built dialog or portal,
   and new controls use a component rather than a raw `<button>`.
10. **Copy follows the brand book**: Kubernetes words keep Kubernetes casing;
   everything else is sentence case; "…" for work in progress; "·" to join
   facts; no emoji in new UI.

## The tests that enforce it

All run with `pnpm --filter @kubebay/shell test`:

- `src/__tests__/shellAdoption.test.ts`: no hand-written tables, page headers,
  inputs, keycaps, nav classes, empty states, banners, design-system-class
  buttons or inline brand marks in shell TSX; no colour literals outside the
  data files; every form `Button` declares its `type`.
- `src/__tests__/themeTokens.test.ts`: every `--kb-*` variable used is declared;
  all 12 themes define the same tokens; package classes are styled only in
  `styles.css`; `app.css` never names a package class; `app.css` has no colour
  literals; Settings swatches match their themes.
- `src/__tests__/themeContrast.test.ts`: WCAG contrast for every theme.
- `src/__tests__/cssHygiene.test.ts`: every `var(--kb-*)` in TSX exists; font
  sizes, radii, durations and z-index come from their scales; no unused
  `app.css` classes, keyframes or page modules; reduced motion lives in the
  package; no hand-built dialogs or portals, no new `position: fixed` in
  `app.css`, and the per-file count of raw `<button>`s may only go down.
- `src/components/__tests__/ui*.test.tsx`: behaviour of each component.
- `src/__tests__/brandAssets.test.ts`: every favicon, app icon and website
  logo uses the mark's gradient, and the website takes its colours from
  `tokens.css`.

## Changing the system

- **A new component or variant**: write its test in
  `web/apps/shell/src/components/__tests__/`, implement it in
  `web/packages/ui/src/`, put its styles in `styles.css`, export it from
  `index.tsx`, then use it in the shell. If it replaces a hand-written
  pattern, add that pattern to `shellAdoption.test.ts`.
- **A new token**: add it to every theme block in `tokens.css` (the tokens test
  fails otherwise) and check the contrast test still passes.
- **After merging a design-system change**, re-sync the design system artifact
  so its tokens, previews and brand book match the code.
