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
| Type scale, spacing, radii, motion | `web/packages/ui/src/tokens.css` (`:root`) | `--kb-text-*`, `--kb-space-*`, `--kb-radius-*`, `--kb-dur*`, `--kb-ease*` |
| Component styles | `web/packages/ui/src/styles.css` | the only CSS for package classes |
| Core components | `web/packages/ui/src/index.tsx` | `Button`, `ArmedButton`, `Card`, `Badge`, `StatusDot`, `Skeleton` |
| Shell components | `web/packages/ui/src/shell.tsx` | `StatusPill`/`phaseTone`, `Tabs`, `NavItem`/`NavSection`/`navItemClass`, `TextField`, `Select`, `Kbd`, `PageHeader`, `ContextMenu` |
| Tables and feedback | `web/packages/ui/src/table.tsx` | `DataTable`, `TableWrap`, `Table`, `SortHeader`, `SelectAllHeader`, `SelectCell`, `TableRow`, `NsPill`, `SkeletonRows`, `EmptyState`, `InlineBanner` |
| Brand mark | `web/packages/ui/src/brand.tsx` | `KubebayMark` |
| Icons | `web/packages/ui/src/icons.tsx` | 18 stroke icons, `currentColor` |
| Page layout, one-off page styling | `web/apps/shell/src/app.css` | layout only; never a package class |

## Rules

1. **Use the component, not its class name.** Tables, page headers, inputs,
   selects, keycaps, nav links, tabs, status pills, menus, empty states,
   banners and buttons are rendered with their `@kubebay/ui` component. Router
   links take `navItemClass()`.
2. **Every table is the ResourceTable design.** Use `DataTable` for ordinary
   tables (columns, rows, optional sort, selection, row click, `loading`,
   `empty`). Use the primitives (`TableWrap`, `Table`, `SortHeader`,
   `SelectAllHeader`, `SelectCell`, `TableRow`, `NsPill`, `SkeletonRows`) only
   when a table needs virtualisation, column resizing or expandable rows.
   Name cells take `className="mono td-name"`, secondary facts `cell-secondary`,
   namespaces `NsPill`, phases `StatusPill` (with `phaseTone` for pods).
3. **Colours come from tokens.** No hex, `rgb()` or `rgba()` literals in shell
   TSX or `app.css`, and no `var(--kb-x, #fallback)` fallbacks. The only
   exceptions are data: the Settings theme swatches, user-picked cluster
   colours (`ClusterIconPicker.tsx`) and chart series (`PodGraphs.tsx`). Text on
   a user-picked colour uses `avatarLabelColor()`.
4. **Never restyle a package class from `app.css`.** If a component needs a new
   look, add a prop or variant to the component and its styles to
   `styles.css`. A later `app.css` rule silently overrides the design system;
   that is how ghost and danger buttons drifted before this was enforced.
5. **Every theme must stay readable.** Text reads at 4.5:1 or better on every
   ground in every theme (7:1 in Dawn HC and Dusk HC), status pills and labels
   on fills reach 4.5:1, and focus rings are solid and at least 3:1. Adding or
   changing a colour means updating all 12 theme blocks; the contrast test
   computes the ratios from `tokens.css`.
6. **Labels on fills use their on-colour token**: `--kb-accent-fg` on
   `--kb-accent`, `--kb-on-danger` on `--kb-status-err`. Never `#fff`.
7. **Buttons**: `primary` for the one action a view is for, `ghost` for
   everything else, `danger-ghost` for the first step of a destructive action
   and `danger` (or `ArmedButton`) to confirm it. `Button` defaults to
   `type="button"`; a form's submit button must say `type="submit"`.
8. **Copy follows the brand book**: Kubernetes words keep Kubernetes casing;
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
- `src/components/__tests__/ui*.test.tsx`: behaviour of each component.

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
