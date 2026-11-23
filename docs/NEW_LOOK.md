# A block-grid new look for Kubebay (backlog 57)

Research and plan only. No tokens, components or pages change with this document.

The owner's brief: current Lens and Freelens look like block design. Everything is rectangular or
square, so every screen reads as a grid even though you can't see any grid lines. This document
explains where that look comes from, with exact values, puts it next to Kubebay as it is today, and
plans a new look that can ship in small slices behind the existing guard tests.

Checked 2026-11-23. Sources:

- **Freelens**: github.com/freelensapp/freelens (MIT) at `main` commit `040e95a` (2026-11-23), and
  its GitHub releases up to v2.1.0 (2026-11-21). Values were read from SCSS and YAML. No code is
  copied here.
- **Lens**: docs.lenshq.io. Its release notes, the Preferences and Layout pages, and the screenshots
  those pages publish (`layout-2024.png` at 1920x1040, `flux-resource-list.png` and
  `flux-detail.png` at 2880x1572 Retina, dated July 2026 in the image, and `preferences-tables.png`).
  Lens Desktop is closed source, so its geometry was measured from pixels. That assumes a 2x device
  pixel ratio for the Retina images, and readings are within about 1 css px.
- **Kubebay**: `web/packages/ui/src/tokens.css`, `styles.css`, `shell.tsx`, `overlays.tsx`,
  `table.tsx`, `web/apps/shell/src/app.css`, `src/lib/display.ts` and `src/main.tsx` at `6ebe224`.

How sure each value is:

| Label | Meaning |
|---|---|
| **V** | Verified: read from source code or from the vendor's own text |
| **M** | Measured from a vendor screenshot, within about 1 css px |
| **I** | Inferred: a reasoned reading that wasn't confirmed |

---

## 1. Why Lens and Freelens read as a grid without grid lines

Six mechanisms, in order of how much each adds to the look. No single one makes the effect. It comes
from all of them together.

1. **Fixed bar heights on a shared rhythm.** Every horizontal band has a fixed height of about 32–40
   px:
   - title bar 40
   - tab strip 33
   - list toolbar 40
   - table header 34
   - each table row 33
   - dock tab strip 33
   - drawer header 40
   - drawer property rows 34
   - status bar 21

   Bands stack without gaps, so the eye sees regular courses of brick (M for Lens, V for Freelens:
   `--main-layout-header: 40px`, `--status-bar-height: 21px`, row = `rowLineHeight 17 + 2 × rowPadding 8 = 33px`).
2. **Shade steps rather than borders.** Regions differ by background luminance only, and the steps
   are tiny:
   - Lens dark: chrome `#181a1c` against content `#1f2123`, a ratio of **1.08:1** (M).
   - Freelens dark: `mainBackground #1e2124` against `contentColor #262b2f`, **1.13:1**, and the
     sidebar `#36393e` against content, **1.23:1** (V).

   A boundary at 1.1:1 reads as "a different block", not as a line.
3. **Hairlines below the threshold of seeing a "line".** Where there is a rule it's near-invisible:
   - Lens 2026: a 1 device-pixel (0.5 css px) rule `#2e2f31` on `#1f2123`, **1.21:1** (M).
   - Lens 2026 drawer rows: `#383a3e`, **1.42:1** (M).
   - Freelens: `borderFaintColor #373a3e` on content, **1.25:1** (V).

   They mark edges without drawing a cage.
4. **Square corners on every region and near-square corners on controls.** Panels, the sidebar,
   drawers, tables, tab strips and overview cards have radius 0. Controls take Freelens's single
   `--border-radius: 3px` (V). In the Freelens source, 3px and 4px are the most common literal radii
   after `$radius` and 50% (V: about 40 declarations together). Pills (999px) appear only inside
   progress bars and dots (V).
5. **Shared edges.** One gutter (Freelens `$unit` 8px: table cells pad 8px, headers 16px, drawers
   24px) puts the sidebar text, toolbar, table first column and drawer label column on the same few
   vertical lines (V). The drawer is a two-column CSS grid with the label column at
   `minmax(30%, min-content)`, so every value starts on one edge (V,
   `drawer/drawer-item.scss`). Lens does the same: the label column sits at a fixed x (M).
6. **Full-bleed selection.** A selected sidebar item or table row fills its whole band, edge to edge,
   with no inset rounded "chip":
   - Freelens: a 4px accent bar at the left of a selected row (V, `table/table.scss`), and the
     active nav item is a full-width solid accent fill (V, `sidebar-items.module.scss`).
   - Lens: a flat lighter band (`#282a2d`) the width of the navigator (M).

   The highlight becomes another rectangle in the grid.

Two smaller contributors:

- **Overview cards as blocks.** Freelens v2.1.0 "overviews as cards" draws each card as a
  `contentColor` rectangle with `border: 0`, no radius and no shadow, in a CSS grid with
  `gap: 16px` on the darker page (V, `overview-cards/*.scss`, `cluster-overview.module.scss`). The
  gap is the only separator.
- **The drawer is flush.** The Lens details panel starts directly under the tab strip, runs to the
  window's right edge and status bar, and has the same background as the list. It is set off by a
  1-device-px rule and a soft ~11 css px shadow (M). There is no floating sheet, rounded corner or
  inset margin.

What it is not: Lens and Freelens don't use a visible grid, outlined cards, or a strict 8px baseline
for type. The grid is an illusion built from fixed-height bands, square regions and shade steps.

---

## 2. Lens and Freelens: exact values

### 2.1 Freelens (source, `main` 040e95a)

| Property | Value | Source | |
|---|---|---|---|
| UI font stack | `"Roboto", "Helvetica", "Arial", sans-serif` | `renderer/components/app.scss` `:root --font-main` | V |
| Roboto faces bundled | 300, 300 italic, 400, 700 (no 500 face) | `renderer/components/fonts.scss` | V |
| Mono stack (UI) | `Lucida Console, Monaco, Consolas, monospace` | `app.scss --font-monospace` | V |
| Terminal and editor fonts | 9 bundled Nerd Fonts (JetBrains Mono, Fira Code, Roboto Mono…) | `features/terminal/renderer/fonts/` | V |
| Spacing unit | `--unit: 8px`; `$padding = $margin = 8px` | `app.scss`, `vars.scss` | V |
| Base font size | `--font-size: calc(1.75 × 8px)` = **14px** | `app.scss` | V |
| Small / big | 12px / 16px | `app.scss` | V |
| Headings | h1 28, h2 24, h3 20, h4 18, h5 16, h6 12; weight normal | `app.scss` | V |
| Weights | thin 300, normal 400, "bold" 500 | `vars.scss` | V |
| Weight 500 as rendered | rendered as Regular 400, because no 500 face ships and CSS matching falls back to 400 | CSS font matching against `fonts.scss` | I |
| Body line height | not set, so `normal` (about 1.17 for Roboto) | `app.scss` body rule | V / I |
| Table cell line height | 1.1 | `table/table-cell.scss` | V |
| Base radius | `--border-radius: 3px` (buttons, inputs, search, badges) | `app.scss`, `button.scss`, `badge.module.scss` | V |
| Menu radius | 4px; items 6px | `menu/menu.scss` | V |
| Panel and card radius | 0 (none declared) | `overview-cards/*.scss`, `drawer/drawer.scss` | V |
| Table row height | 33px (17px line + 8px + 8px), virtualised | `table/table.tsx` defaults | V |
| Table cell padding | 8px | `table-cell.scss` | V |
| Table header | `tableHeaderBackground`, 1px `borderFaintColor` underline, weight 600 when `flat` | `table-head.scss` | V |
| Row selection | `tableBgcSelected` fill + 4px `--primary` bar at the left edge | `table.scss` | V |
| Striping | optional `tableBgcStripe` on odd rows | `table.scss` | V |
| Row menu column | fixed 55px | `table.mixins.scss` | V |
| Checkbox column | fixed 32px | `table-cell.scss` | V |
| Sidebar width | 200px default, resizable | `layout/sidebar-storage/sidebar-storage.injectable.ts` | V |
| Hotbar (cluster rail) width | 75px | `cluster-manager/cluster-manager.scss` | V |
| Sidebar item | padding 6px 8px 6px 10px, gap 8px; active or hover = full-width `--primary` fill | `layout/sidebar-items.module.scss` | V |
| Sub-menu | 4px left rule, 25px indent, 4px vertical padding | same | V |
| Top bar | 40px, `layoutBackground` | `top-bar.module.scss`, `app.scss` | V |
| Cluster tab strip | 34px, `layoutTabsBackground` | `layout/tab-layout.scss` | V |
| Dock tab | 32px high, min 120px wide, 1px right divider, 1px accent underline when active | `dock/dock-tab.module.scss`, `dock-tabs.module.scss` | V |
| Status bar | 21px, solid `--primary` fill, small text | `status-bar.module.scss`, `app.scss` | V |
| Drawer | `contentColor`, shadow `0 0 16px boxShadow`, inner spacing 24px | `drawer/drawer.scss` | V |
| Drawer title | min-height 54px, solid accent (`--blue`) fill, bold title | `drawer.scss` | V |
| Drawer property row | 2-column grid, label `minmax(30%, min-content)`, 8px vertical padding, 1px `borderFaintColor` rule | `drawer/drawer-item.scss` | V |
| Search input | padding 6px 6px 6px 10px, radius 3px, drawn by a 1px `halfGray` inset ring | `input/search-input.scss` | V |
| Button | padding 7px 12px, radius 3px, line height 1, 14px | `ui-components/button/src/button.scss` | V |
| Badge | padding 0.2rem 0.4rem, radius 3px, `colorVague` fill | `badge/badge.module.scss` | V |
| Overview cards | padding 16px, `border: 0`, no radius, grid `minmax(200px, 1fr)`, gap 16px; numbers 26 or 30px bold | `overview-cards/*.scss` | V |
| Themes | 8 built-in YAML themes (Freelens, Ayu, Ayu Mirage, Dracula, Graphite, Catppuccin, Solarized, High Contrast "7:1"), each dark and light; accent colour picker; zoom 67–200% | v2.1.0 release notes, `features/theme/files/common/` | V |
| Density setting | none; zoom is the only scale control | preferences source tree | V |

Freelens dark (built-in theme `freelens.theme.yaml`, colours by role, V):

| Role | Dark | Light |
|---|---|---|
| App frame (`mainBackground`) | `#1e2124` | `#f1f1f1` |
| Content (`contentColor`) | `#262b2f` | `#ffffff` (corrected in round 2: it was "n/a in excerpt") |
| Top bar (`layoutBackground`) | `#2e3136` | `#e8e8e8` |
| Sidebar | `#36393e` | `#e8e8e8` |
| Table header | `#262b2f` | `#f1f1f1` |
| Selected row | `#383c42` | `#f4f5f5` |
| Stripe | `#2a2d33` | `#f8f8f8` |
| Text primary / secondary | `#8e9297` / `#a0a0a0` | `#555555` / `#51575d` |
| Border / faint border | `#4c5053` / `#373a3e` | `#c9cfd3` / `#dfdfdf` |
| Accent (`primary`) | `#00a7a0` | `#00a7a0` |
| Ok / warn / error | `#4caf50` / `#ff9800` / `#ce3933` | `#399c3d` / `#ff9800` / `#ce3933` |

Contrast, computed by us from these values:

| Pair | Ratio | Verdict |
|---|---|---|
| Primary text on content | 4.57:1 | barely AA |
| White on the teal accent (status bar, drawer title, active nav) | **2.99:1** | fails AA |
| Content against frame | 1.13:1 | |
| Faint border against content | 1.25:1 | |

### 2.2 Lens Desktop (docs, release notes and screenshots)

| Property | Value | Source | |
|---|---|---|---|
| Redesign | "Revamped UI/UX: … completely redesigned user interface"; "Unified Navigator" | release 2024.9.30 (`lens-2024-9-300059`) | V |
| Default font size | "The default font size is now increased to 14px" | release 2025.5.8 (`lens-2025-5-81206`) | V |
| Dark contrast | "New Dark Theme Colors: Adjusted colors to increase contrast" | release 2025.5.8 | V |
| Row heights | "Table Styling: Adjusted row heights to improve table readability" | release 2025.6.2 (`lens-2025-6-21515`) | V |
| Light contrast | "Improved text contrast in light theme" | release 2026.4.14 | V |
| Themes | "Sync with computer", "Dark", "Light" | Preferences page | V |
| Table density control | Preferences → Tables → "Row Line Height" (screenshot shows **20**) | Preferences page, `preferences-tables.png` | V (the field) / I (20 as the default) |
| UI font family | not documented. Lens inherits Roboto from OpenLens, but the 2026 screenshots look like a wider humanist sans. Not confirmed. | screenshots | I |
| Title bar | ~40px | `flux-resource-list.png` | M |
| Hotbar (cluster rail) | ~58px | same | M |
| Navigator width | ~280px (2026), ~310px (2024) | same, `layout-2024.png` | M |
| Navigator row pitch | ~22px (2026), 24px (2024) | same | M |
| Tab strip | ~33px; tabs square, 1px dividers, active tab = content shade with an accent top line | same | M |
| List toolbar | ~40px | same | M |
| Table header / row | ~34px / ~33px; no row rules, hairline under the header | same | M |
| Details panel header | ~40px strip in the chrome shade, title in bold, icon actions at the right | `flux-detail.png` | M |
| Details property row | ~34px, label column at a fixed x, hairline `#383a3e` between rows | same | M |
| Condition chips | square-cornered (~2px), solid green for Ready | same | M |
| Dock tab strip / status bar | ~33px / ~20px | same | M |
| Colours (dark, 2026) | chrome `#181a1c`; content `#1f2123`; hairline `#2e2f31`; selected row `#37383e`; selected nav `#282a2d` | pixels of `flux-*.png` | M |
| Colours (dark, 2024) | frame `#1c1e20`; content `#222427`; hairline `#2d3338` (1.22:1) | pixels of `layout-2024.png` | M |

---

## 3. Kubebay today

### 3.1 Tokens (`tokens.css` `:root`)

| Area | Value |
|---|---|
| Font | `"Roboto", -apple-system, "Helvetica Neue", "Segoe UI", Arial, sans-serif`. Roboto 300, 400, 500 and 700 are bundled through `@fontsource/roboto` (`main.tsx`). |
| Mono | `ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace`. JetBrains Mono is optional in Settings. |
| Type scale (M) | 11 / 12 / 13 / **14** / 16 / 20 / 30px. Settings sizes S, L and XL shift it (S bottoms out at **10px**). |
| Body | 14px, line height 1.5, letter spacing −0.003em (`app.css`) |
| Weights in use | 500, 600, 700. Roboto 600 has no face, so it renders as 700 (I, by CSS matching). |
| Spacing | 4 / 8 / 12 / 16 / 24 / 32; gutter 16px |
| Radius | 2xs 2, xs 4, sm 6, **default 8**, lg 14, pill 999 |
| Shadows | `--kb-shadow-rest` on cards and primary buttons; `-lift` on drawers and menus; `-menu`; `--kb-highlight-inset` |
| Borders | `--kb-border-subtle` (Dusk white 8%), `-strong` (14%), `-control` (34%) |
| Surfaces (Dusk) | canvas `#161617`, surface `#1c1c1e`, raised `#242426`, overlay `#2c2c2e`, inset `#0f0f10`; sidebar and material translucent, with a 24px blur |
| Surface steps (Dusk) | surface against canvas 1.06:1; raised against surface 1.10:1; inset against surface 1.13:1 |
| Density (`display.ts`) | row padding 4 / 8 / 12 px × 16px. Virtualised row heights 35 / **43** / 51px, set by the 26px row-menu button rather than by the text. **Corrected in round 2:** the button does set the height, but only because `.col-row-menu { padding: 0 }` (specificity 0,1,0) loses to `.kb-table td { padding: var(--kb-row-padding) }` (0,1,1), so the menu cell is 26 + 2 × padding = 34 / **42** / 50px. The extra 1px in `ROW_HEIGHT` and `rowHeight.test.ts` is a "row rule" that no CSS draws (rows have no rule). Text alone would give 29 / 37 / 45px (a 21px line box at 1.5 × 14px). Whether the rendered row is 42 or 43 is unverified without rendering; the virtualiser measures each row anyway. |

Kubebay already matches Lens and Freelens on font family (Roboto) and base size (14px). The
difference the owner sees isn't type. It's shape, height and separation.

### 3.2 Components

| Component | Today |
|---|---|
| `DataTable` / `.kb-table` | th 12px uppercase, 500 weight, `--kb-fg-subtle`, translucent header with an 8px blur, 1px subtle underline. **Corrected in round 2:** that's only non-sortable headers. Every `SortHeader` gets `.th-sortable`, which is **13px mixed case, `--kb-fg-muted`**, so the headers of resource lists are already mixed case. td 8px × 16px; no row rules; hover and selected both draw a 3px inset accent bar; **42–43px rows** |
| `PageHeader` | 40px, 1px bottom border, translucent surface (60%) |
| `.toolbar` | 38px, 1px bottom border |
| Nav (`NavItem`) | padding 6px 10px, **radius 8px**, inset 8px inside the sidebar; active = 60% accent tint + 3px inset accent bar + 600 weight |
| Sidebar | 210px plus a 56px cluster rail; **frosted translucent** with a 24px blur; 1px right border |
| `Tabs` | strip padding 8px 12px, gap 4px; tab padding 7px 14px, **radius 6px**; active = 2px accent underline; hover fills a rounded chip |
| `Drawer` | `min(820px, 75vw)`, surface, 1px strong left border, **lift shadow**; head padding 12px 16px |
| Drawer properties (`.pod-kv`) | flex space-between, 3px vertical padding (~27px), no rules; value right-aligned; section titles uppercase 12px with an underline |
| `Button` | padding 6px 13px, **radius 6px**, 500 weight; primary has a rest shadow and inset highlight; ghost has a 1px strong border |
| `TextField` / `Select` | 26px, radius 6px, inset ground, 1px control border |
| `StatusPill` | **pill 999px**, 1px tinted border, 12px |
| `NsPill` | pill 999px, accent tint, 18px line |
| `Badge` | radius 4px, mono 12px, inset ground and border |
| `Card` | surface, 1px border, **radius 8px**, rest shadow + inset highlight; interactive lifts 1px with a lift shadow |
| `IconButton` | 26px (32px for `lg`), radius 6px |
| `SegmentedControl` | radius 6px outer, 4px segments |
| `ContextMenu` | radius 8px, lift shadow, 4px padding |
| `InlineBanner` / `EmptyState` | radius 8px / 6px with a dashed border |
| Status bar (`app.css`) | ~29px, translucent with a 12px blur, mono 12px, accent gradient top line |
| `body::before` | two radial accent "glows" behind the app |

Radius declarations: `styles.css` has 42 (11 default, 11 pill, 9 sm, 8 xs, 1 lg, 1 2xs, 1 at 50%; corrected in round 2, it said 40). `app.css` has 45
(15 default, 12 sm, 9 xs, 6 at 50%). Shadow declarations in `app.css`: 14.

What makes Kubebay read as "macOS sheets" rather than blocks:

- rounded chips nested inside panels (nav, tabs, inputs, cards)
- translucency and blur
- shadows on resting things
- pills
- 43px rows that break the 32–40px rhythm
- a drawer that floats over the page

### 3.3 Side by side

| Property | Kubebay today | Lens / Freelens | Proposed (block look) |
|---|---|---|---|
| UI font | Roboto + system fallbacks | Freelens Roboto (V); Lens unconfirmed (I) | **Keep Roboto** |
| Mono | system mono stack | Freelens Lucida Console / Monaco / Consolas | Keep the system mono stack |
| Base size | 14px | 14px (V both) | **14px** |
| Small text floor | 11px (10px at S) | 12px (Freelens) | **11px floor at every size** (S becomes 11 / 12 / 13 / 13…) |
| Body line height | 1.5 | normal ≈1.17; cells 1.1 | **1.43 (20px on 14px)** for body, **20px fixed** line box in rows |
| Weights | 500 / 600 / 700 | 300 / 400 / 500 (renders as 400) | **400 / 500 / 700** only (drop 600) |
| Spacing unit | 4px scale, 16px gutter | 8px unit | Keep the 4px scale; **heights and gutters on 8px** |
| Control radius | 6px | 3px | **2px** (`--kb-radius-sm`/`xs` in block look) |
| Panel and card radius | 8–14px | 0 | **0** |
| Pill radius | 999px on status and ns pills | progress and dots only | **2px** on pills; dots stay round |
| Shadows | rest on cards and buttons, lift on drawer | drawer and menus only | **Menus and dialogs only**; the drawer gets an edge shadow |
| Separation | 1px borders + shadows + blur | shade steps 1.08–1.25:1 + hairlines 1.2–1.4:1 | **Surface levels** ≥1.10:1 + one hairline token; borders kept only in HC themes |
| Table row | 43px | 33px (both) | **32px default**, 28 compact, 40 relaxed |
| Table header | 13px mixed case on sortable columns, 12px uppercase on the rest; blur (corrected in round 2) | 14px sentence case, solid | **13px sentence case on every column** (round 2, R1), **solid chrome shade**, 32px |
| Page header | 40px | ~40px toolbar | **40px** |
| Toolbar | 38px | ~40px | **40px** (merged with the page header where a page has both, see 5.2) |
| Tab strip | ~50px, rounded chips | 33–34px, square | **36px**, square, 2px accent underline |
| Sidebar | 210px frosted, rounded inset items | 200 (Freelens) / ~280 (Lens), opaque, full-bleed items | **216px opaque chrome**, full-bleed 28px items |
| Cluster rail | 56px | 75 / ~58px | **56px** (unchanged) |
| Selected nav | rounded tint + 3px bar | full-bleed fill or band | **full-bleed band in the selected shade + 3px accent bar** |
| Selected row | tint | fill + 4px accent bar | **fill + 3px accent bar** |
| Drawer | floating sheet, lift shadow, 12px × 16px head | flush, 40–54px head strip, grid rows with hairlines | **flush**, 40px chrome head, 2-column grid rows of 32px with hairlines |
| Status bar | ~29px translucent | 20–21px | **24px opaque chrome** (never accent-filled: white on teal fails at 2.99:1) |
| Inputs | 26px, 6px radius | ~30px, 3px | **28px**, 2px radius |
| Buttons | ~29px, 6px radius, shadow | ~30px, 3px | **28px**, 2px radius, no shadow; `sm` 24px |
| Cards | bordered, rounded, shadow | borderless blocks, gap 16 | **borderless blocks on `--kb-bg-chrome`, gap 8**, radius 0 |
| Glow and blur | yes | no | **off** in the block look |

---

## 4. Cross-challenge: four roles

Each role posted a position first. The positions were then challenged pairwise. Below are the
disagreements and how each was settled. The plan in section 5 follows only the settled verdicts.

### 4.1 Opening positions

- **Visual designer.** Go all the way to radius 0 everywhere and remove every border. Add three new
  surface levels (chrome, panel, well), 32px rows, a flush drawer, and drop uppercase headers for
  sentence case as Lens has it.
- **Front-end engineer.** Most of this is token retuning, not component rewrites. Radius, row padding
  and heights are already tokens or `display.ts` values. Every new colour token costs 12 theme blocks
  and another ground in `themeContrast`. Adds the fewest colour tokens possible, and puts the look
  behind an attribute so it can be compared and rolled back.
- **Accessibility reviewer.** Shade steps of 1.08:1 aren't perceivable for many low-vision users, and
  in Dawn HC and Dusk HC they're unacceptable. Square, unbordered controls can lose their 3:1 control
  boundary (WCAG 1.4.11). The S font size already produces 10px text. The block look must not lower
  any floor.
- **Power-user SRE.** Lens and Freelens are 33px. Kubebay at 43px shows about 23% fewer pods per
  screen (a 900px table area holds 20 rows at 43px and 27 at 33px). 32px should be the default, with
  a 28px compact for incident work. Don't hide the namespace pill or the status colour to get there.

### 4.2 Disagreements and resolutions

| # | Disagreement | Who | Resolution |
|---|---|---|---|
| D1 | Radius 0 on controls too, or a small radius? | Designer (0) vs A11y (a radius helps people see where a control is) | **Panels, cards, drawers, tables, tab strips: 0. Controls (buttons, inputs, pills, segments): 2px.** The control boundary comes from `--kb-border-control` (≥3:1, already tested), not from the radius. Focus rings stay solid at 2px. Lens's 2–3px chips on 2026 screenshots support 2px. |
| D2 | Remove all borders and separate by shade alone? | Designer vs A11y | **Shade steps for regions, plus one hairline token, `--kb-separator`, between bands.** In the normal themes the hairline is `--kb-border-subtle`, which already exists. **In Dawn HC and Dusk HC, region boundaries keep a visible border ≥3:1** (`--kb-border-strong`), because shade alone can't carry structure there. Freelens's own High Contrast theme also uses `borderFaintColor #7a7a7a` on black (V). |
| D3 | Three new surface tokens (chrome, panel, well)? | Designer vs Engineer | **One new colour token: `--kb-bg-chrome`** (sidebar, tab strips, table header, drawer head, status bar, the ground cards sit on). Content stays `--kb-bg-surface`, wells stay `--kb-bg-inset`, selected stays the existing selected-row tint. A new token goes in 12 blocks and becomes a ground in `themeContrast` ("text tokens meet the floor on every ground", "status colours read on raised and inset grounds"). That's one ground to add, not three. |
| D4 | How big a shade step between chrome and surface? | Designer (1.08, as Lens) vs A11y (≥1.5) | **≥1.10:1 and ≤1.30:1 in normal themes, enforced by a new `themeContrast` case.** Above 1.3 it reads as a frame, not a block (Freelens sidebar 1.23). The boundary isn't the only cue: the hairline and fixed heights carry it too. HC themes get their border (D2). |
| D5 | Sentence-case table headers like Lens? | Designer vs SRE | **Superseded in round 2 (R1): the premise was wrong, sortable headers are already 13px mixed case.** Original verdict: **Keep 12px uppercase headers.** Kubebay users already scan them, and they set the header apart from data without a heavier shade. Revisit with the owner (Q6). |
| D6 | 32px or 28px default rows? | SRE (28) vs A11y and Designer (32) | **32px default, 28px compact, 40px relaxed.** 28px with 13px text keeps the line box above the text with 4px to spare, but the row-menu target becomes 24px. That meets WCAG 2.5.8 (24×24 minimum), but only just, so compact stays opt-in. |
| D7 | What sets row height? | Engineer | **Refined in round 2 (R2): no new IconButton size is needed.** Original verdict: **Fix the coupling the comments in `display.ts` describe.** The 26px `.kb-icon-btn` sets row height today. Add an `IconButton size="row"` (22px at default, 20px compact, 24px relaxed) so the text line box (20px) plus padding sets the row. `ROW_HEIGHT` becomes 28 / 32 / 40, and the virtualiser tests move with it. |
| D8 | Minimum text size | A11y vs SRE (who wants more in a compact row) | **11px floor at every Settings size.** The S scale changes from `10, 11, 12…` to `11, 11, 12, 13, 15, 18, 28`. Mono cells stay a step below table text, but never under 12px. Compact rows use 13px text, not 12px. |
| D9 | Solid accent status bar and drawer title like Freelens? | Designer vs A11y | **Rejected.** Freelens's white on `#00a7a0` is 2.99:1. Kubebay keeps a chrome-shaded status bar and drawer head with default text. Where the accent appears as a fill (primary button, active segment), the existing `--kb-accent-fg` rule and contrast test already apply. |
| D10 | Replace the current look, or offer both? | Designer (replace) vs Engineer (attribute) vs SRE (doesn't care if density is right) | **Superseded in round 2 (R4): no `data-look`.** Original verdict: **Ship behind `data-look="block"` on `<html>`, orthogonal to `data-theme`, so all 12 themes work in both looks.** While it is built, the default stays Classic. Flipping the default is a separate owner decision after the theme audit (Q1, Q2). The look attribute overrides only `:root`-level scale tokens plus a handful of component rules in `styles.css`, so `themeTokens` ("all 12 themes define the same tokens") is unaffected. |
| D11 | Flush drawer: lose the click-outside affordance? | SRE vs Designer | **Flush to the top (under the tab strip or page header) and to the right, full height to the status bar. It keeps an edge shadow on its leading side and a hairline**, so the boundary still shows where a click closes it. The behaviour rules in `DESIGN_SYSTEM.md` (Escape, press-behind, focus return) are unchanged. |
| D12 | Translucency and blur | Designer (remove) vs owner's macOS feel | **Off in the block look** (opaque chrome). Classic keeps them. Blur also costs compositing on WebKit (see `PERFORMANCE.md`), which is a small bonus for the SRE. |
| D13 | Font: switch to a Lens-like humanist sans? | Designer (curious) vs Engineer and A11y | **Keep Roboto.** Freelens uses it (V), Lens's current family isn't confirmed (I), and the block feel doesn't come from the font. Drop weight 600, which renders as 700 anyway, and use 500 for emphasis and 700 for titles. Roboto 500 is already bundled. |

### 4.3 Final consolidated verdict

Build a block look in tokens and a few component variants, not a rewrite. It has square regions,
2px controls, fixed 8px-multiple band heights, one new chrome surface and one hairline,
full-bleed selection and 32px rows. The tests guard it, HC themes keep their borders, and it ships
behind `data-look` until the owner flips the default.

---

## 5. The plan

### 5.1 Principles of the block-grid look

1. **Every band has a fixed height on the 8px grid**, set from a token: 24 (status), 28 (control,
   nav item, compact row), 32 (row, table header, drawer row), 36 (tab strip), 40 (page header, toolbar,
   drawer head).
2. **Regions are square.** Radius 0 for anything that tiles the window. 2px only for things you
   press or read as a chip.
3. **Separate by surface, not by outline.** Chrome is one shade, content another. A hairline marks a
   band edge. No resting shadows.
4. **Shared edges.** The 16px gutter is the left edge of the page title, toolbar, first column and
   drawer label column. Drawer values start on one column line.
5. **Selection fills the band.** Full-bleed shade plus a 3px accent bar, never an inset rounded chip.
6. **Density from the line box.** Text sets the row (20px line box + padding), not a control inside
   it.
7. **High contrast keeps its edges.** In Dawn HC and Dusk HC, every region boundary is a ≥3:1 border.

### 5.2 Token set (block look)

New `:root` tokens. They are not colours, so they aren't per-theme:

```
--kb-unit: 8px;                 /* layout heights and gutters are multiples */
--kb-h-status:   24px;
--kb-h-control:  28px;          /* buttons, inputs, selects, segmented */
--kb-h-control-sm: 24px;
--kb-h-nav:      28px;          /* sidebar item */
--kb-h-tabs:     36px;
--kb-h-bar:      40px;          /* page header, toolbar, drawer head */
--kb-h-row:      32px;          /* set by Settings → Density: 28 / 32 / 40 */
--kb-line-row:   20px;          /* line box inside a row */
--kb-sidebar-w:  216px;
```

Retuned under `:root[data-look="block"]`. Classic keeps today's values:

| Token | Classic | Block |
|---|---|---|
| `--kb-radius-2xs` | 2px | 0 |
| `--kb-radius-xs` | 4px | 2px |
| `--kb-radius-sm` | 6px | 2px |
| `--kb-radius` | 8px | 0 |
| `--kb-radius-lg` | 14px | 0 |
| `--kb-radius-pill` | 999px | 2px (dots use `50%`, which is already allowed) |
| `--kb-shadow-rest` | per theme | `none`, via a look override that the token test allows |
| `--kb-material-blur` | blur 24px | `none` |

Two consequences need a decision during slice 1 (they are not blockers):

- `--kb-radius-pill: 2px` flips every pill at once. Check each use, because some may need to stay
  round.
- Overriding a colour-block token such as `--kb-shadow-rest` from a look block may need a small
  allowance in `themeTokens`, or a separate `--kb-shadow-card` token that both looks set.

New colour tokens, in **all 12 theme blocks**:

| Token | Role | Starting values (to be tuned by the audit) |
|---|---|---|
| `--kb-bg-chrome` | sidebar, tab strips, table header, drawer head, status bar, ground behind block cards | Dusk: a step below surface (≈`#111112`, 1.11:1; corrected in round 2: the `#141415` given here was 1.08:1 and failed the plan's own 1.10 floor); Dawn: ≈`#ececf1` (1.18:1 against white); HC themes: same as canvas, with borders |
| `--kb-separator` | hairline between bands and drawer rows | an alias for `--kb-border-subtle` in normal themes and `--kb-border-strong` in HC. It's declared per theme, so it needs no new colour. |

Type: keep the seven `--kb-text-*` steps. Change the S row in `TYPE_SCALE` to `11, 11, 12, 13, 15,
18, 28`. Body line height becomes 1.43 in the block look. Weights are 400, 500 and 700.

### 5.3 Component by component

| Component | Change (block look) | Files |
|---|---|---|
| App frame | Opaque `--kb-bg-chrome` sidebar and rail, no blur, no `body::before` glow; content `--kb-bg-surface` | `app.css` layout rules (a look selector on `.app`, not a package class) |
| `NavItem` / `NavSection` | Full-bleed, height `--kb-h-nav`, radius 0, no sidebar side padding; active = selected shade + 3px accent bar, weight 500; section labels 11px uppercase, 24px | `styles.css` `.nav-item`, `.nav-section`, `.nav-group-title`; `app.css` `.sidebar` padding |
| `PageHeader` | `--kb-h-bar`, opaque chrome or surface (no 60% translucency), hairline bottom; title 16px 500 | `styles.css` `.page-header` |
| Toolbar | `--kb-h-bar`; inputs at `--kb-h-control` vertically centred | `styles.css` `.toolbar` |
| `Tabs` | `--kb-h-tabs` strip in chrome, no strip padding; tabs square, full-height, 1px separator between tabs, active = surface shade + 2px accent underline | `styles.css` `.tabs`, `.tab`, `.drawer-pane-tabs` |
| `DataTable` and primitives | th solid `--kb-bg-chrome`, no blur, `--kb-h-row` tall, 12px uppercase kept; td line box `--kb-line-row` and padding from density; rows 28 / 32 / 40; selected = tint + 3px accent bar on the first cell | `styles.css` `.kb-table`; `display.ts` `ROW_PADDING_VALUES`, `ROW_HEIGHT` |
| `IconButton` | new `size="row"` (22px) for row menus; radius from `--kb-radius-sm` (2px) | `shell.tsx`, `styles.css`, plus a test in `components/__tests__/` |
| `StatusPill` / `NsPill` / `Badge` | radius `--kb-radius-pill` (now 2px), 18px line box, tinted border kept for 3:1 edges in HC | `styles.css` `.status-*`, `.ns-pill`, `.kb-badge` |
| `Button` | height `--kb-h-control`, radius 2px, no rest shadow or inset highlight; `sm` = `--kb-h-control-sm` | `styles.css` `.kb-btn*` |
| `TextField` / `Select` / `SegmentedControl` | `--kb-h-control`, radius 2px, control border unchanged | `styles.css` `.toolbar-input`, `.toolbar-select`, `.kb-segmented` |
| `Card` | **block variant**: no border, no shadow, radius 0, surface on a chrome ground, gap 8px in grids; interactive = hover shade, no lift; `selected` keeps the 3px inset bar | `styles.css` `.kb-card*` (look selector); overview grids in `app.css` use `Stack`/`Row` gap 2 |
| `Drawer` | flush top (below the bar) and right, full height; leading-edge shadow + hairline, no strong border; head `--kb-h-bar` in chrome; width unchanged | `overlays.tsx` (no API change), `styles.css` `.drawer*` |
| Drawer properties | `.pod-kv` becomes a 2-column grid: label column `minmax(30%, max-content)`, values left-aligned on one edge, rows `--kb-h-row` with a `--kb-separator` hairline; section titles become 32px chrome bands | `app.css` `.pod-kv`, `.pod-section*`. A new `PropertyList` component would remove the ad hoc versions (follow-up, slice 6b). |
| `ContextMenu` / `Modal` / `HelpTip` | radius 2px, shadow kept (they float), items 28px | `styles.css` |
| `InlineBanner` / `EmptyState` | radius 0, 3px leading status bar instead of a full tinted border; empty state loses the dashed border and becomes a plain surface block | `styles.css` |
| Status bar | `--kb-h-status`, opaque chrome, hairline top; drop the gradient line | `app.css` `.statusbar` |
| Settings | Appearance → **Look: Classic / Block** (`SegmentedControl`), next to Theme, Font size and Density | `pages/Settings*`, `display.ts` (`look` store key, sets `data-look`) |

### 5.4 Mock-ups

#### Pods page, before (Classic)

```
 rail  sidebar (frosted, 210)           content
┌────┬──────────────────────┬──────────────────────────────────────────────────────────────┐
│ ◉  │  KUBEBAY             │  Pods · 128  ● live                        [ Delete ] [ ⋯ ]  │ 40
│    │                      ├──────────────────────────────────────────────────────────────┤
│ ○  │  ╭────────────────╮  │  ╭─────────────────╮ ╭──────────╮                            │ 38
│    │  │▌ Pods           │  │  │ ⌕ Filter pods   │ │ all ns ▾ │                            │
│ ○  │  ╰────────────────╯  │  ╰─────────────────╯ ╰──────────╯                            │
│    │    Deployments       ├──────────────────────────────────────────────────────────────┤
│    │    StatefulSets      │  ☐  NAME              NAMESPACE     STATUS       AGE      ⋯  │
│    │    DaemonSets        │                                                              │
│    │    Jobs              │  ☐  api-7f9c-x2       (default)    (Running)    3d       ⋯  │ 43
│    │                      │                                                              │
│    │  NETWORK             │  ☐  worker-55d-k9     (jobs)       (Pending)    2m       ⋯  │ 43
│    │    Services          │                                                              │
│    │    Ingresses         │  ☐  db-0              (data)       (Running)    12d      ⋯  │ 43
│    │                      │                                                              │
├────┴──────────────────────┴──────────────────────────────────────────────────────────────┤
│ ● kind-dev · v1.31 · 3 nodes                                       ~29px translucent     │
└──────────────────────────────────────────────────────────────────────────────────────────┘
 ╭╮ = 6–8px rounded chips   ( ) = 999px pills   rows 43px, no lines, blur behind sidebar
```

#### Pods page, after (Block, 32px rows)

```
 rail  sidebar (chrome, 216)        content (surface)
┌────┬──────────────────────┬──────────────────────────────────────────────────────────────┐
│ ◉  │ KUBEBAY              │ Pods · 128  ● live                         [Delete] [⋯]      │ 40
│    ├──────────────────────┼──────────────────────────────────────────────────────────────┤
│ ○  │ WORKLOADS            │ [⌕ Filter pods          ] [all ns ▾]                         │ 40
│    │█▌Pods████████████████├──────────────────────────────────────────────────────────────┤
│ ○  │  Deployments         │▒☐ NAME             │NAMESPACE  │STATUS     │AGE  │         ⋯▒│ 32 chrome
│    │  StatefulSets        ├──────────────────────────────────────────────────────────────┤
│    │  DaemonSets          │ ☐ api-7f9c-x2       [default]  [Running]   3d              ⋯ │ 32
│    │  Jobs                │ ☐ worker-55d-k9     [jobs]     [Pending]   2m              ⋯ │ 32
│    │ NETWORK              │▌☐ db-0              [data]     [Running]   12d             ⋯ │ 32 selected
│    │  Services            │ ☐ cache-1           [data]     [Running]   12d             ⋯ │ 32
│    │  Ingresses           │ ☐ cron-28-abc       [jobs]     [Succeeded] 4h              ⋯ │ 32
├────┴──────────────────────┴──────────────────────────────────────────────────────────────┤
│ ● kind-dev · v1.31 · 3 nodes                                             24px chrome      │
└──────────────────────────────────────────────────────────────────────────────────────────┘
 [ ] = 2px chips   █ = full-bleed selected band   ▌= 3px accent bar   ▒ = chrome shade
 One left edge at 16px for title, filter, checkbox. Header column edges are implied by the
 text start, not drawn (the │ marks only show the alignment).
 900px of table: 20 rows before, 28 after (+40%). (Corrected in round 2: it said 27, +35%;
 27 is the count at Lens's 33px.)
```

#### Drawer, before (Classic)

```
                          ┌──────────────────────────────────────────────┐ ← floats over the page,
                          │  api-7f9c-x2                  [⤢] [⋯] [✕]   │   lift shadow, strong border
                          │  Pod · default                               │
                          │ ╭────────╮╭──────╮╭──────╮╭──────╮           │
                          │ │Overview││ YAML ││ Logs ││Events│           │
                          │ ╰────────╯╰──────╯╰──────╯╰──────╯           │
                          │  METADATA                                    │
                          │  ────────────────────────────────────────    │
                          │  Namespace                         default   │ ~27
                          │  Node                       kind-worker-2    │ ~27
                          │  Created                    3d ago (…)       │ ~27
                          │  Status                       (Running)      │
                          │                                              │
                          │  CONTAINERS                                  │
                          │  ────────────────────────────────────────    │
                          │  ╭──────────────────────────────────────╮    │
                          │  │ api   ghcr.io/acme/api:1.4  (Ready)   │    │
                          │  ╰──────────────────────────────────────╯    │
                          └──────────────────────────────────────────────┘
```

#### Drawer, after (Block)

```
 page (behind)          ░┃▒ api-7f9c-x2 · Pod · default             [⤢] [⋯] [✕] ▒│ 40 chrome
                        ░┃▒[Overview]│ YAML │ Logs │ Events │                    ▒│ 36 chrome, square tabs
                        ░┃ METADATA ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│ 32 chrome band
                        ░┃ Namespace       │ default                            │ 32
                        ░┃─────────────────┼────────────────────────────────────│ hairline
                        ░┃ Node            │ kind-worker-2                      │ 32
                        ░┃─────────────────┼────────────────────────────────────│
                        ░┃ Created         │ 3d ago (2026-11-20 09:14)          │ 32
                        ░┃─────────────────┼────────────────────────────────────│
                        ░┃ Status          │ [Running]                          │ 32
                        ░┃ CONTAINERS ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│ 32 chrome band
                        ░┃ api             │ ghcr.io/acme/api:1.4   [Ready]     │ 32
                        ░┃                                                      │
 ░ = edge shadow  ┃ = hairline   flush under the page header, down to the status bar,
 label column = minmax(30%, max-content); every value starts on one edge. │ marks are
 alignment only; the vertical label/value rule isn't drawn.
```

### 5.5 Rollout in slices

Each slice follows the repo's TDD rule and has its own failing test first. Each one updates the
user manual (`website/src/content/docs/`, the Settings → Appearance page) when it changes something
a user would see. Each one also runs the theme audit (`scripts/theme-audit/theme-audit.mjs`) when it
changes colour or ground.

| # | Slice | Visible? | Guard tests that keep it safe | New test first |
|---|---|---|---|---|
| 0 | Height and look tokens in `:root` (`--kb-h-*`, `--kb-line-row`, `--kb-sidebar-w`). Classic values equal today's, so nothing moves. | no | `themeTokens` (every var declared), `cssHygiene` (scales) | `cssHygiene`: heights of `.page-header`, `.toolbar`, `.tabs`, rows and controls use `--kb-h-*` (fails until they do) |
| 1 | `data-look` attribute + Settings → Look (Classic / Block) + `:root[data-look="block"]` radius, blur and shadow overrides | yes, opt-in | `cssHygiene` (radii from scale), `themeTokens` (no theme-block drift), `shellAdoption` (Settings uses `SegmentedControl`) | `display.test.ts`: the look persists and sets the attribute; `blockLook.test.ts`: under block, no resolved radius above 2px except `50%` |
| 2 | `--kb-bg-chrome` + `--kb-separator` in all 12 themes; chrome-to-surface step 1.10–1.30 in normal themes, HC borders | yes, block only | `themeTokens` (12 blocks), `themeContrast` with **chrome added to the grounds list** (text, status, focus, pills on chrome) | `themeContrast`: "chrome is a visible step from surface (1.10–1.30) in normal themes"; "HC region borders ≥3:1" |
| 3 | App frame: opaque chrome sidebar, rail and status bar; no glow; full-bleed `NavItem` | yes | `shellAdoption` (nav via `NavItem` / `navItemClass`), `themeContrast` (active nav text on chrome and selected), `cssHygiene` (no colour literals, no new `position: fixed`) | `uiNav.test.tsx`: the active item exposes `aria-current` and still shows its bar (behaviour, not pixels) |
| 4 | Tables: `IconButton size="row"`, `ROW_HEIGHT` 28 / 32 / 40, solid chrome header, selected bar | yes (both looks get the density fix) | `shellAdoption` (no hand tables), `themeContrast` ("a selected table row keeps its text, pills and namespace readable"), the perf budgets in CI (100k-row scroll) | `display.test.ts`: `ROW_HEIGHT` equals line box + padding + border; `uiTable.test.tsx`: the row-menu button meets the 24×24 target at default |
| 5 | PageHeader, toolbar, `Tabs`: fixed heights, square tabs | yes | `shellAdoption` (headers and tabs via components), `cssHygiene` | `uiTabs.test.tsx`: arrow-key and selection behaviour unchanged |
| 6 | Drawer flush + chrome head; drawer property grid (6b: `PropertyList` component replacing `.pod-kv`) | yes | `shellAdoption` (add `.pod-kv`/hand-built key-value rows to the banned patterns once `PropertyList` exists), `cssHygiene` (no hand-built portals), drawer behaviour tests | `uiPropertyList.test.tsx`: label/value pairs render as a description list (`dl/dt/dd`) for screen readers |
| 7 | Buttons, inputs, selects, segmented, pills, badges: control heights, 2px radius, no resting shadow | yes | `themeContrast` ("form control borders reach 3:1", "tinted fills keep their text readable", "danger buttons take their label colour from a token"), `shellAdoption` (form `Button` `type`) | `uiButton.test.tsx`: `size="sm"` still renders the small variant |
| 8 | Cards to blocks; banners and empty states | yes | `shellAdoption` (empty states and banners via components), `themeContrast` | the overview grid test asserts the `Stack`/`Row` gap token rather than margins |
| 9 | 11px floor: the S scale becomes 11 / 11 / 12 / 13…; mono never under 12 | yes | `cssHygiene` (font sizes from the scale) | `display.test.ts`: no `TYPE_SCALE` step under 11 |
| 10 | Owner decision: make Block the default (and maybe retire Classic). Re-sync the design-system artifact; update `DESIGN_SYSTEM.md` with the block principles | yes | all four, plus a full theme audit in all 12 themes × 2 looks × 3 densities | none (decision slice) |

After every slice, take a post-ship screenshot of the Pods page and of an open drawer in Dusk, Dawn
and Dusk HC, as `CLAUDE.md` requires.

### 5.6 Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Shade steps too faint on some panels or in some light themes (GitHub Light, VS Code Light); regions merge | medium | Slice 2's step test is a range, not a floor of 1.0; the hairline is the second cue; the theme audit measures real composited grounds |
| HC themes look heavy with borders everywhere | medium | Borders only on region edges, not on rows; owner review of Dusk HC in slice 2 |
| 32px rows clip two-line cells (labels, multi-container dots) | medium | Cells that wrap opt into `auto` height in non-virtualised tables; virtualised tables already truncate |
| A 22px row-menu button is a smaller target | low | Meets 24×24 because the hit area includes the cell padding; compact stays opt-in; test in slice 4 |
| `--kb-radius-pill: 2px` squares something that must stay round (avatars, toggles, progress caps) | medium | Use `50%` for circles (already allowed); grep every `radius-pill` use in slice 1 |
| `app.css` page rules with literal heights or paddings fight the fixed bands | high | Slice 0's hygiene test finds them; fix the rule, never restyle a package class from `app.css` |
| Two looks double the visual QA surface | high | The look is temporary scaffolding; retire Classic at slice 10 unless the owner keeps it (Q2) |
| WebKit sub-pixel hairlines (0.5px) render unevenly at 1x | low | Use 1px rules in a faint colour; don't copy Lens's 0.5px |
| Users read the change as "Kubebay copied Lens" | low | Kubebay keeps its own accent, 12 themes, uppercase headers and brand; describe it in the manual as a density and clarity change |
| Performance: removing blur helps; more hairlines don't cost much | n/a | Run the CI perf budgets as part of slice 4 |

### 5.7 Open questions for the owner

1. **Default look.** After slice 9, should Block become the default for everyone, or only for new
   installs?
2. **Keep the current look as an option?** Keep "Classic" permanently next to Block in Settings
   (twice the QA), or retire it once Block ships? A middle way is to keep Classic only as a look for
   the Dusk and Dawn themes.
3. **Default density.** Should the default row be 32px (proposed; Lens and Freelens use 33), or
   28px (compact) to win more rows? Should Kubebay offer Lens's free numeric "Row line height"
   instead of three steps?
4. **Accent bar for selection.** Is a 3px left accent bar on selected rows and nav items wanted, or
   only a shade change as in Lens 2026?
5. **Sidebar width.** Proposed 216px; Lens uses ~280. Make it resizable, as Freelens does (200
   default, drag to resize)?
6. **Table header case.** Keep UPPERCASE 12px headers (proposed), or switch to sentence case 13px
   as Lens and Freelens do?
7. **Zoom.** Freelens v2.1.0 added a 67–200% zoom. Should Kubebay add zoom on top of font size and
   density, or is font size enough?
8. **Cards on overview pages.** Should block cards keep a status-coloured top or leading edge, or
   stay plain?
9. **Website.** Should kubebay.sardar.dev take the block look too, so the screenshots in the manual
   match?

---

## Appendix: where each Freelens value was read

All paths are under `packages/core/src/renderer/components/` unless shown otherwise.

| File | Values read from it |
|---|---|
| `app.scss` | `--unit`, `--border-radius`, fonts, font sizes, header and status bar heights, headings |
| `vars.scss` | weights, `$unit`, `$padding` |
| `fonts.scss` | Roboto faces |
| `table/table.tsx` (`rowPadding: 8`, `rowLineHeight: 17`), `table/table.scss`, `table-cell.scss`, `table-head.scss`, `table.mixins.scss` | table row height, padding, header, selection and fixed columns |
| `layout/main-layout.module.scss`, `layout/sidebar-storage/sidebar-storage.injectable.ts` (`defaultSidebarWidth = 200`), `layout/sidebar-items.module.scss`, `layout/top-bar/top-bar.module.scss`, `layout/tab-layout.scss` | frame grid, sidebar width and items, top bar, tab strip |
| `cluster-manager/cluster-manager.scss` | `--hotbar-width: 75px` |
| `drawer/drawer.scss`, `drawer/drawer-item.scss`, `drawer/drawer-title.scss` | drawer, title strip and property grid |
| `dock/dock-tab.module.scss`, `dock/dock-tabs.module.scss`, `status-bar/status-bar.module.scss` | dock tabs and status bar |
| `overview-cards/capacity-card.scss`, `overview-cards/status-card.scss`, `cluster/cluster-overview.module.scss` | overview cards and their grid |
| `input/search-input.scss`, `menu/menu.scss`, `badge/badge.module.scss`, `packages/ui-components/button/src/button.scss` | controls |
| `packages/core/src/features/theme/files/common/freelens.theme.yaml`, `high-contrast.theme.yaml`, `docs/themes.md` | colours by role |

---

## Debate round 2 and final verdict

Round 1 (sections 1 to 5) was written by one agent playing four roles. Round 2 is an independent
cross-challenge: it re-checked the key facts against the Freelens source (`main`, fetched
2026-11-23) and the Kubebay code at this commit, then argued the plan from three viewpoints round 1
under-weighted: a long-session SRE, a maintainer, and a brand/product owner. Where round 2 corrected
a number in the body, the body now says "corrected in round 2". Where it disagrees with a verdict,
the verdict in section 4.2 is marked superseded or refined and the resolution is here. **Section 5.5
(the slice order) and the look-attribute parts of 5.2 and 5.3 are replaced by the revised slice
order below.**

### Fact check

Freelens values were read again from the source files the appendix names. Contrast ratios were
recomputed with the WCAG 2 formula.

| Claim | Verdict | Notes |
|---|---|---|
| Freelens font stack `"Roboto", "Helvetica", "Arial", sans-serif` | confirmed | `app.scss` `--font-main` |
| Roboto faces 300, 300 italic, 400, 700; no 500 | confirmed | `fonts.scss` |
| Weights thin 300 / normal 400 / "bold" 500; 500 renders as 400 | confirmed | `vars.scss`. CSS font matching for 500 tries lighter weights first, so it lands on 400 |
| Kubebay 600 renders as 700 | confirmed | Kubebay bundles 300/400/500/700 (`main.tsx`); 600 matches heavier first, so 700. `.td-name` uses 600, so every name cell is really bold |
| Base 14px (`calc(1.75 × 8px)`), small 12, big 16 | confirmed | `app.scss` |
| Row 33px = 17 line + 2 × 8 padding | confirmed | `table.tsx` defaults `rowPadding: 8`, `rowLineHeight: 17`, `customRowHeights = lineHeight + paddings` |
| `--border-radius: 3px`; menu 4px, items 6px | confirmed | `app.scss`, `menu/menu.scss` |
| "3px and 4px are the most common literal radii, about 40 declarations" | unverifiable | not recounted; it doesn't change any decision |
| Sidebar 200px default | confirmed | `defaultSidebarWidth = 200` |
| Hotbar 75px; top bar 40px; status bar 21px | confirmed | `cluster-manager.scss`, `app.scss` |
| Selected row: 4px `--primary` bar | confirmed | `table.scss` |
| Row-menu column 55px | confirmed | `table.mixins.scss` |
| Drawer title min-height 54px, `--blue` fill (= `#00a7a0` in the Freelens theme), shadow `0 0 16px` | confirmed | `drawer.scss`, `freelens.theme.yaml` |
| Drawer item 2-column grid, 8px vertical padding | confirmed | `drawer-item.scss` |
| Status bar solid `--primary`, text `textColorOnPrimary #ffffff` | confirmed | `status-bar.module.scss`, theme YAML |
| Theme colours (dark) | confirmed | all values in 2.1 match `freelens.theme.yaml` |
| Light `contentColor` "n/a" | **wrong**, it is `#ffffff` | fixed in the body |
| HC `borderFaintColor #7a7a7a` on black | confirmed; it is **4.89:1** | |
| Primary text on content 4.57:1 | confirmed (4.567) | |
| White on teal 2.99:1 | confirmed (2.985) | |
| Content against frame 1.13:1; sidebar against content 1.23:1; faint border 1.25:1 | confirmed (1.132, 1.233, 1.251) | |
| Not in round 1: Freelens primary text on its own sidebar `#36393e` | **3.70:1, fails AA** | if sidebar items inherit `textColorPrimary`, which the item rule suggests. A warning against copying Freelens greys |
| Lens values (all M) | unverifiable here | the arithmetic is right: 1.08, 1.21, 1.42, 1.22 recompute exactly from the quoted hexes. The pixel readings themselves weren't re-measured |
| Kubebay Dusk steps 1.06 / 1.10 / 1.13 | confirmed (1.063, 1.098, 1.126) | |
| Kubebay `--kb-border-subtle` (white 8%) on Dusk surface | 1.26:1, so it is already a Freelens-weight hairline | supports `--kb-separator` as an alias |
| Proposed Dusk chrome `#141415` "~1.10:1" | **wrong: 1.08:1**, under the plan's own 1.10 floor | `#111112` gives 1.11:1. Fixed in the body. Note it sits next to `--kb-bg-inset` `#0f0f10` (1.13:1), see R5 |
| Sidebar 210px + 56px rail; page header 40; toolbar 38; status bar ~29 (5 + 18 + 5 + 1) | confirmed | `app.css` grid `56px 210px`, `styles.css`. A literal `calc(56px + 210px + 20px)` in `app.css` also depends on the width |
| Nav radius 8, tabs 6, buttons 6, inputs 26px/6, card 8 + rest shadow | confirmed | `styles.css` |
| Radius declarations in `styles.css`: 40 | **wrong: 42** (adds 1 at 2xs and 1 at 50%) | fixed in the body; `app.css` 45 and 14 shadows confirmed |
| "th 12px uppercase" | **wrong for most tables** | `SortHeader` adds `.th-sortable`: 13px, mixed case, `--kb-fg-muted`. Only non-sortable headers are uppercase. Fixed in the body |
| 43px rows "set by the 26px row-menu button" | **half right** | the button sets it only because `.col-row-menu { padding: 0 }` loses on specificity to `.kb-table td`, so the button also gets the row padding: 26 + 16 = 42. The "+1px rule" in `ROW_HEIGHT` and `rowHeight.test.ts` has no CSS behind it. Fixed in the body |
| Mock-up "27 rows after (+35%)" at 32px | **wrong: 28 rows (+40%)** | 900 / 32 = 28.1; 27 is the count at 33px. Fixed in the body |
| "23% fewer pods" at 43 vs 33 | roughly right | 1 − 33/43 = 23% continuous; 20 vs 27 whole rows is 26% |

### Disagreements and resolutions

**R1. Table headers: the uppercase question was settled on a wrong premise (long-session SRE).**
D5 kept "12px uppercase headers that users already scan". Kubebay's resource lists already use 13px
mixed-case muted headers (`.th-sortable`). Only non-sortable headers, such as most `DataTable`
uses, are uppercase, so today's tables mix the two. For an eight-hour session, all-caps 12px with
letter spacing is the harder of the two to read, and it is the minority case.
*Resolution:* one header style everywhere, 13px sentence case in `--kb-fg-muted` at weight 500, on
a solid header. Drop the uppercase path. This is a small, low-risk slice that everyone gets.

**R2. Row height: fix the specificity bug, not the button (maintainer and SRE).**
D7 proposed a new `IconButton size="row"` of 22px. Its numbers don't work: in a 32px row with 6px
padding, a 22px button in a padded cell is 34px, so the row stays above 32. The real defect is that
the row-menu cell's `padding: 0` never applies.
*Resolution:* make `.kb-table td.col-row-menu` padding 0 win, and give `td` a fixed 20px line box.
Set the row padding to 4 / 6 / 10px (compact keeps 13px text in its 20px box). Rows then come out at
28 / 32 / 40 and the 26px button fits in every one, so no new component size is needed. The row
menu keeps a 26px target, which is better than 22px for WCAG 2.5.8. `rowHeight.test.ts` is
rewritten first: line box + 2 × padding, with no phantom rule, plus a CSS assertion that the menu
cell has no padding.

**R3. Hover and selection look the same (long-session SRE).**
Today `tr:hover` and `tr.selected` both draw the 3px inset accent bar. The plan made the bar "the
selection cue", but a pointer resting over a table would still paint one. During triage that's a
false "this row is selected" signal.
*Resolution:* hover is a shade only. The accent bar marks the selected row and the keyboard cursor
row only. Nav items follow the same rule. Pinned lead cells repaint the same way. A behaviour test
checks that the hovered row has no bar class.

**R4. No parallel `data-look` system: change the system itself (maintainer).**
D10 put the look behind `data-look="block"`. That means 12 themes × 2 looks × 3 densities = 72
combinations to audit, and a look block overriding per-theme tokens such as `--kb-shadow-rest`,
which round 1 already admitted needs a `themeTokens` exception. Most of the work isn't a matter of
taste anyway. Correct row heights, one header style, 8px band heights, the 11px floor and the hover
fix are fixes that nobody would choose "Classic" to keep. Two further points:

- The website imports `tokens.css`, so a `:root` retune reaches kubebay.sardar.dev. That is the
  wanted outcome (round 1's Q9 answers itself), but it means every slice runs the website build.
- A look attribute would also need its own Settings control, store key, docs and window-sync key.

*Resolution:* no `data-look` and no Settings → Look. Every slice changes the one system directly,
small enough to review from screenshots and to roll back with `git revert`. The shape slice (R6) is
the only one that is taste-heavy. It is staged so the owner sees screenshots of Dusk, Dawn and Dusk
HC before it merges.

**R5. One chrome token is still one too many in some themes (maintainer).**
In Dusk the corrected chrome `#111112` is almost `--kb-bg-inset` `#0f0f10`. Inputs sit on inset, so
a toolbar input on chrome loses its well and leans entirely on its control border. In One Dark,
Dracula and Catppuccin, canvas is *lighter* than surface, so "chrome darker than surface" isn't a
universal rule.
*Resolution:* keep the one token, but define it by role and test it both ways:

- `themeContrast` asserts the chrome-to-surface step (1.10–1.30 either direction) and that the
  input control border stays ≥3:1 on chrome.
- Where a theme's canvas already makes that step, chrome is set to the canvas hex, so there is no
  new colour to tune.
- Values are hex literals, because the contrast test only parses hex and `color-mix(… transparent)`.

**R6. A Lens look-alike loses Kubebay's identity (brand/product).**
Radius 0 or 2 everywhere, opaque grey chrome, no glow and no gradient: that is Freelens with a cyan
accent. Kubebay's tells are the cyan accent, the cyan-to-green brand gradient, mono identifiers in
tables, 12 themes with real HC, and a macOS softness.
*Resolution:* "tiles are square, floats are soft". It keeps the grid feel and is Kubebay's own rule
rather than Lens's.

- **Tiles are square, radius 0:** anything that tiles the window, meaning panels, the sidebar, tab
  strips, tables, the drawer and cards.
- **Controls get 2px:** buttons, inputs, pills and segments.
- **Floats keep 6px and their shadow:** menus, modals, the command palette and HelpTips.
- **The brand gradient stays as a signature:** a 1px top rule on the status bar from
  `--kb-brand-cyan` to `--kb-brand-green`. That's where round 1 dropped "the gradient line".
- The `body::before` glows go.
- Never fill a bar with the accent.

Do this with **role tokens**: `--kb-radius-tile`, `--kb-radius-control` and `--kb-radius-float`,
with uses migrated to them. Don't flatten the size scale to 0 / 2 / 2 / 0 / 0, because that would
make `--kb-radius-lg: 0` mean nothing and defeat the "radii from the scale" hygiene test.
Separately, keep the sidebar at **210px** and put it in a `--kb-sidebar-w` token that also fixes the
`calc(56px + 210px + 20px)` literal. 216 was change for its own sake.

**R7. Eye strain from the grey palette (long-session SRE).**
The grid look gets its reputation partly from dim text. Freelens primary text is 4.57:1 on content
and about 3.7:1 on its sidebar. Kubebay must not import that.
*Resolution:* the new look changes no `--kb-fg-*` token. `themeContrast` gains chrome as a fifth
ground, so default, muted and subtle text, status pills and focus rings are checked on it. On a
darker chrome, Dusk subtle text rises from 4.74:1 to about 5.26:1. The body line height of 1.43
(20px on 14px) stands.

### Final recommended direction

Evolve the one design system in place, with no second look. Fix density and consistency first,
because everyone gains and nobody will miss what goes:

- rows 28 / 32 / 40 from a 20px line box
- one sentence-case header
- bands on 8px heights
- an 11px floor
- hover without the selection bar

Then change shape by role: square tiles, 2px controls, soft floats. Add one chrome ground, defined
by role and tested in all 12 themes, with HC themes keeping ≥3:1 region borders. Make chrome
opaque, with no glow and no resting shadows, and keep the cyan accent and the brand gradient
hairline as Kubebay's signature. The drawer goes flush with a `PropertyList`, and cards become
blocks, last.

### Revised slice order (smallest first)

Each slice writes its failing test first, updates the user manual page for what changed, runs
`themeContrast`/`themeTokens`/`shellAdoption`/`cssHygiene` and (for colour or ground changes) the
theme audit, and builds the website because it shares `tokens.css`.

| # | Slice | First failing test |
|---|---|---|
| 1 | Row geometry: menu-cell padding 0 actually applies, `td` 20px line box, padding 4 / 6 / 10, `ROW_HEIGHT` 28 / 32 / 40 | `rowHeight.test.ts` rewritten (line box + padding, no phantom rule); CSS assertion on `.col-row-menu` |
| 2 | One header style: 13px sentence case, muted, solid background (no blur) | `uiTableAndFeedback`: a non-sortable header has the same class as a sortable one |
| 3 | Hover is shade only; accent bar marks selected and the keyboard cursor row | `uiTable…`: hovered row has no bar, selected row keeps it |
| 4 | 11px floor (S scale 11 / 11 / 12 / 13 / 15 / 18 / 28; mono ≥12) | `display.test.ts`: no `TYPE_SCALE` step under 11 |
| 5 | Height tokens `--kb-h-*` and `--kb-sidebar-w` (210) at today's values, then bands to 40 / 36 / 24 | `cssHygiene`: bands use `--kb-h-*`; no `210px` literal |
| 6 | Role radii (`tile` 0, `control` 2, `float` 6), uses migrated; pills 2px, dots `50%`; no resting shadow on cards and buttons. Owner screenshot review before merge | `cssHygiene`: radii are role tokens; no resting shadow on `.kb-card`/`.kb-btn` |
| 7 | `--kb-bg-chrome` in 12 themes; opaque sidebar, rail and status bar; glow off; gradient hairline on the status bar; full-bleed `NavItem` | `themeContrast`: chrome step 1.10–1.30, text and control borders on chrome, HC region borders ≥3:1 |
| 8 | Drawer flush with chrome head; `PropertyList` (`dl/dt/dd`) replaces `.pod-kv` | `uiPropertyList.test.tsx`; then ban `.pod-kv` in `shellAdoption` |
| 9 | Cards as blocks; banners and empty states square | overview grid uses `Stack`/`Row` gap |
| 10 | Update `DESIGN_SYSTEM.md` with the principles and re-sync the design-system artifact | none (docs) |

### Questions for the owner

1. **Ship each slice straight to everyone, with no Classic/Block switch?** *Recommended: yes.*
   Rollback is `git revert`, and you review screenshots before the shape slice (6) merges.
2. **Default row height?** *Recommended: 32px by default, with 28 compact and 40 relaxed.* Keep the
   three steps rather than Lens's free "row line height" number.
3. **Table headers: one 13px sentence-case style everywhere?** *Recommended: yes.* Most headers
   already use it, and the uppercase ones go.
4. **Radius by role: square tiles, 2px controls, 6px floating menus and dialogs?** *Recommended: yes.*
   It gives the grid feel without becoming a Freelens copy.
5. **Drop translucency and the background glow, keeping the brand gradient as a 1px status-bar
   rule?** *Recommended: yes.* Opaque chrome is also cheaper to composite in WebKit.
6. **Sidebar: keep 210px fixed for now, with resizing as a separate backlog item?**
   *Recommended: yes.* Zoom (round 1's Q7) is out of scope, because font size and density cover it.
