# Pink theme plan

Status: plan, nothing implemented by this document. Blossom (light) is built and unreleased. Date of the research: 2026-11-25.

## 1. Decision

The request was a pink theme "the same as the most famous and most used pink theme of all". No single most-used pink theme can be verified. Three independent research passes found no install count for any dedicated pink theme, and no popular theme has a pink base. What can be verified is below.

| Theme | Verified evidence (fetched 2026-11-25) | Pink in it |
|---|---|---|
| Dracula | 11,176,307 VS Code installs, https://marketplace.visualstudio.com/items?itemName=dracula-theme.theme-dracula ; about 23.6k stars, https://github.com/dracula/dracula-theme | Dark theme, pink is one accent (#ff79c6) |
| Catppuccin | 1,504,825 VS Code installs, https://marketplace.visualstudio.com/items?itemName=Catppuccin.catppuccin-vsc ; 19,977 stars (GitHub API), https://github.com/catppuccin/catppuccin | Blue-grey bases (Latte #eff1f5, Mocha #1e1e2e); pink is an accent |
| Rosé Pine | 353,274 VS Code installs, https://marketplace.visualstudio.com/items?itemName=mvllow.rose-pine ; 1,636 stars (GitHub API), https://github.com/rose-pine/rose-pine-theme | Rose and cream tones, light variant "Dawn" (base #faf4ed); the closest to a pink character |
| Pink Cat Boo | 74 GitHub stars (https://github.com/ftsamoyed/PinkCatBoo); marketplace installs unverified (page returned 404) | Dark theme with a coral-pink accent; licence header names a different copyright holder |

**Reference we follow: Rosé Pine, Dawn for the light theme, Main/Moon for the dark one.** We follow its structure (a role-named palette, pink as an accent on low-chroma surfaces, a light and a dark pair), not its hex values.

Confidence, stated honestly:
- About 90% that no single most-used pink theme can be verified.
- About 55% that Rosé Pine is the right single reference. The pick rests on how rosy the theme is and on its MIT licence, not on popularity. Catppuccin has about 4 times its installs and Dracula about 30 times.
- Runner-up: Catppuccin (Latte, Mocha). We borrow only the idea of a named secondary accent set (rosewater, flamingo, pink), for the dark theme only. Its light pinks fail as text (Latte pink #ea76cb is 2.34:1 on #eff1f5).
- Unverified: dedicated pink themes' install counts, JetBrains and other marketplaces, and any data on who uses pink dev themes. If the owner wants the ranking settled, paste the marketplace counts for Pink Cat Boo and similar themes.

Audience framing: describe the theme as "a soft rose theme for everyone", not "for women". The only evidence found is Wikipedia-level (https://en.wikipedia.org/wiki/Pink): pink became gendered in the 1930s to 50s, and one cited survey had 3% of women and under 1% of men naming pink a favourite. That is one survey and says nothing about developer themes. Design for taste range: calm, warm, rosy.

## 2. Blossom today versus the reference

Source: the `blossom` block in `web/packages/ui/src/tokens.css` (lines 979 onward). Contrast is the WCAG relative-luminance ratio (L1 + 0.05) / (L2 + 0.05), with L = 0.2126 R + 0.7152 G + 0.0722 B on linearised channels, the same formula as `themeContrast.test.ts`. Dawn values are from https://raw.githubusercontent.com/rose-pine/palette/main/palette.json.

Blossom is already registered everywhere a theme must be: `theme.ts`, `nativeWindow.ts` (`LIGHT_THEMES`), `windowSyncApply.ts`, `index.html` boot colours, Settings swatch, `theme-audit.mjs`, `themeTokens`/`themeContrast`/`monacoTheme`/`nativeWindow`/`themeBoot` tests, and `website/src/content/docs/settings.md`.

| Role | Rosé Pine Dawn (name, hex) | Blossom token, hex | Dawn pair on its base | Blossom pair on canvas #fdeff4 |
|---|---|---|---|---|
| Base | base #faf4ed | `--kb-bg-canvas` #fdeff4 | | |
| Surface | surface #fffaf3 | `--kb-bg-surface` #fffbfd | | |
| Overlay / inset | overlay #f2e9e1 | `--kb-bg-inset` #f9e3ec, `--kb-bg-chrome` #f7dde8 | | |
| Text | text #464261 | `--kb-fg-default` #3b1a2c | 8.69 | 13.74 |
| Subtle text | subtle #797593 | `--kb-fg-muted` #764659 | 4.02 (fails 4.5) | 6.75 |
| Muted text | muted #9893a5 | `--kb-fg-subtle` #84536a | 2.73 (fails) | 5.50 |
| Pink accent | love #b4637a | `--kb-accent` #a81f66 | 3.84 (fails text) | 6.17 |
| Soft pink | rose #d7827e | none | 2.60 (decoration only) | |
| Purple | iris #907aa9 | `--kb-status-done` #6b2fb8 | 3.47 | 6.91 |
| Blue / teal | pine #286983, foam #56949f | `--kb-status-info` #3347b8, chart-5 #0c7285 | 5.59, 3.14 | 6.89, 5.01 |
| Yellow | gold #ea9d34 | `--kb-status-warn` #8f5200 | 2.05 | 5.58 |
| Red | love (shared with accent) | `--kb-status-err` #c2190f | | 5.47 |
| Green | none | `--kb-status-ok` #17703e | | 5.50 |

Other Blossom pairs: accent on surface #fffbfd 6.71; accent on chrome #f7dde8 5.39; accent on inset #f9e3ec 5.64; white on accent 6.88; white on danger #c2190f 6.10; fg-muted on chrome 5.90; fg-subtle on chrome 4.80 (thinnest margin); danger on chrome 4.79; `--kb-status-terminated` #9a8591 on canvas 3.07 (a dot or line, never text).

Findings:
1. Blossom matches Dawn's recipe (warm tinted surfaces, plum text, deep rose accent) and beats it on every text pair. Dawn cannot be copied: its love, subtle and muted all fail 4.5:1.
2. Blossom's canvas (hue 339) is pinker than any Rosé Pine surface (Dawn base hue 32, cream). "Same as Rosé Pine" is only true of structure.
3. Dawn has one colour for both pink accent and error (love). Blossom already separates them, but the gap is thin: accent hue 329, danger hue 3, 34 degrees apart. See section 5.
4. Blossom has no dark twin. Rosé Pine ships Main, Moon and Dawn.

**Verdict: adjust Blossom slightly, and add one second theme, "Blossom Night" (dark). Do not replace Blossom.** Adjustments to Blossom: darken danger to #ae1c06 and warn to #8a5600 so the status hues are 8 and 37 degrees (danger-to-accent 39 degrees; danger-to-warn 29, above the test's 25 degree floor), and add the missing tokens listed in section 3 if themeTokens reports any. Everything else stays.

## 3. Proposed palette

Names in the "Reference name" column are Rosé Pine's where it has one, otherwise Catppuccin's, otherwise "none" (our own role). Hex values are ours, not copies. Night values are proposals measured below; the first failing test in slice 1 will confirm them.

| Token group / token | Reference name | Blossom (light) | Blossom Night (dark) |
|---|---|---|---|
| `--kb-bg-canvas` | base | #fdeff4 | #1d1520 |
| `--kb-bg-surface` | surface | #fffbfd | #251a29 |
| `--kb-bg-raised` | surface | #ffffff | #2d2132 |
| `--kb-bg-overlay` | overlay | #ffffff | #35283b |
| `--kb-bg-inset` | none (Catppuccin mantle) | #f9e3ec | #150e18 |
| `--kb-bg-chrome` | none (Catppuccin crust) | #f7dde8 | #120b15 |
| `--kb-separator` | none | `var(--kb-border-subtle)` | `var(--kb-border-subtle)` |
| `--kb-card-edge` | none | transparent | transparent |
| `--kb-fg-default` | text | #3b1a2c | #f6e4ee |
| `--kb-fg-muted` | subtle | #764659 | #cbaebf |
| `--kb-fg-subtle` | muted | #84536a | #ab93a1 (see note) |
| `--kb-accent` | love | #a81f66 | #f28bb5 |
| `--kb-accent-hover` | none | #891a52 | #f7a6c6 |
| `--kb-accent-subtle` | none | rgba(168,31,102,0.08) | rgba(242,139,181,0.14) |
| `--kb-accent-fg` | none | #ffffff | #2a0f1e |
| `--kb-focus-ring` | none | 0 0 0 2px #a81f66 | 0 0 0 2px #f28bb5 |
| `--kb-selection` | none | rgba(168,31,102,0.16) | rgba(242,139,181,0.22) |
| `--kb-status-err` (danger) | none (Dawn reuses love) | #ae1c06 | #ff7a59 |
| `--kb-on-danger` | none | #ffffff | #2a0f1e |
| `--kb-status-warn` | gold | #8a5600 | #e8b04a |
| `--kb-status-ok` | none (Dawn has no green) | #17703e | #6fcf97 |
| `--kb-status-info`, `--kb-status-pending` | pine | #3347b8 | #8fa8ff |
| `--kb-status-done` | iris | #6b2fb8 | #c4a7e7 |
| `--kb-status-terminated` | muted | #9a8591 | #8d7886 |
| `-subtle` / `-fg` status variants | none | as today, with the new err and warn bases | `color-mix` 14% of the base for subtle; fg is the base |
| `--kb-chart-1` to `-5` | love, pine, gold, iris, foam | #a81f66, #17703e, #a15c00, #6b2fb8, #0c7285 | #f28bb5, #6fcf97, #e8b04a, #c4a7e7, #7fd1e0 |
| `--kb-ns-1` to `-6` | none | unchanged hues, 22% mixes | unchanged hues, 22% mixes |
| `--kb-border-*`, `--kb-highlight-inset` | none | plum-based rgba, as today | rgba(246,228,238, 0.12 / 0.22 / 0.55) and a 4% inset highlight |
| `--kb-shadow-lift`, `--kb-shadow-menu` | none | rose-tinted, as today | black 65% and 55% (as other dark themes) |
| `--kb-theme-color` | base | #fdeff4 | #1d1520 |
| Monaco | none | built-in `vs` | built-in `vs-dark` |
| Terminal (`termTheme.ts`) | none | read from tokens: background inset, cursor accent, red err, green ok, yellow warn, blue accent, cyan info | same mapping |
| Syntax | none | no syntax tokens exist in `tokens.css`; Monaco and xterm supply them | same |

Notes. There are no `--kb-syntax-*` tokens today, so "syntax" is Monaco's built-in theme plus the terminal mapping. The cyan terminal colour reads `--kb-status-info`. Night's `--kb-fg-subtle` is #a58c9b at its floor (4.50 on overlay); #ab93a1 is the proposed value with margin and must be confirmed by the test.

Night contrast, measured (fg on ground): text #f6e4ee on canvas 14.61, surface 13.71, overlay 11.36; muted #cbaebf on canvas 8.77, overlay 6.82, inset 9.34; subtle #a58c9b on canvas 5.78, inset 6.16, chrome 6.29; accent #f28bb5 on canvas 7.74, overlay 6.02, inset 8.25, chrome 8.42; #2a0f1e on accent 7.71, on hover #f7a6c6 9.47; danger #ff7a59 on canvas 6.93, overlay 5.39, inset 7.38, chrome 7.54; #2a0f1e on danger 6.90; ok #6fcf97 on overlay 7.28; warn #e8b04a 7.07; info #8fa8ff 6.07; done #c4a7e7 6.61. Chrome versus surface is 1.16, inside the 1.10 to 1.30 band. Light changes measured: danger #ae1c06 on canvas 6.34, chrome 5.55, inset 5.80, white on it 7.07; warn #8a5600 on canvas 5.52, chrome 4.83.

## 4. Licence and attribution

Facts: Rosé Pine (palette and theme repos) and Catppuccin are MIT licensed (Rosé Pine copyright 2023, Catppuccin 2021). The only MIT condition is to keep the copyright and permission notice with copies or substantial portions. Kubebay's FSL-1.1-MIT does not conflict. I found no trademark rules in either project; that is "none found", not "none exist". This is a reading, not legal advice.

What we do, conservatively:
- Our hex values are our own, picked to pass contrast. No Rosé Pine or Catppuccin value is copied, except as listed below. Colour values are likely not copyrightable, but attribution costs nothing.
- Still add attribution, because the structure and a few accents derive from them. Create `THIRD_PARTY_NOTICES.md` at the repo root (none exists today) with the full MIT text for each, headed "Blossom and Blossom Night take their palette structure and naming from Rosé Pine (Copyright (c) 2023 Rosé Pine) and the dark theme's accent idea from Catppuccin (Copyright (c) 2021 Catppuccin). Both are MIT licensed." Add a one-line pointer in the tokens.css comment above each block and a line in the website docs page.
- Do not call the themes "Rosé Pine" or "Catppuccin", and do not say or imply endorsement. Say "inspired by" in docs only if the owner wants it.
- Pink Cat Boo: take only the coral-pink hue idea. Its LICENSE.md names Jason Milkins (2015), so provenance is unclear. Copy nothing from it.

## 5. Accessibility

Targets, from the repo and WCAG 2.2 (https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html):
- Text 4.5:1 on every ground it sits on (`themeContrast` text tokens, filled and tinted pairs, selected rows, namespace tints, status on raised and inset grounds).
- UI and non-text 3:1: control borders, focus ring, chart series, card and separator edges in HC (WCAG 1.4.11).
- Dark and light "editor themes" use the 4.5 floor (the `NATIVE` list in `themeContrast.test.ts`); only `dawn-hc` and `dusk-hc` use 7.
- Two existing tests bear on pink: "ok, warn and err read as three different statuses" (at least 25 degrees apart, saturation at least 0.5) and "muted text is never mistaken for the accent" (a saturated muted colour must be at least 40 degrees from the accent). Blossom's muted plum (#764659) passes because it is low saturation; keep it so.

Is an HC pink needed? Not in this release. The repo has an HC variant only for the two native themes, and the editor themes are all held at 4.5. If the owner wants one later, it needs accent at least #8a1553 (7.12:1 on chrome #f7dde8, 8.14 on canvas; no margin on chrome, so go a step darker), near-black plum text, and 3:1 separators and card edges. That is a separate slice, listed as an open question.

Colour-blind check, danger versus accent. Pink and red sit close in hue for red-green colour-blind users, and WCAG Use of Color (https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) says colour alone must not carry meaning. Measures: Blossom danger moves to #ae1c06 (hue 8) against accent #a81f66 (hue 329), 39 degrees apart (34 before); in Night, danger #ff7a59 (hue 12, orange) against accent #f28bb5 (hue 336), 36 degrees. Lightness also differs on Night (danger L is higher). Hue and lightness alone are not enough, so the rule is: errors always carry an icon and a text label (the existing `StatusPill`, `Badge tone="err"` and `InlineBanner` do), the accent is never used for a failure state, and warnings never use pink. Verification is a new test (slice 1) asserting danger is at least 36 degrees from the accent hue and that the accent is never one of the three status colours.

## 6. Implementation slices (TDD, each first)

Blossom's registrations already exist, so slices 1 to 3 are small. Each slice: write the failing test, watch it fail for the right reason, then implement. Follow CLAUDE.md (ship the Mac app per commit, screenshot smoke test).

1. **Blossom status tweak and hue-gap guard.** First failing test: in `web/apps/shell/src/__tests__/themeContrast.test.ts`, add "danger is at least 36 degrees from the accent" for blossom (and blossom-night once added); it fails on Blossom today (34 degrees). Then change `--kb-status-err` to #ae1c06 and `--kb-status-warn` to #8a5600 (and their subtle and fg variants) in `tokens.css`. The existing three-statuses test must stay green.
2. **Blossom Night tokens.** First failing test: `themeTokens.test.ts` expects `blossom-night` in its theme list and the same token set as the others (it fails with "theme not found"); `themeContrast.test.ts` adds `blossom-night` to the editor-themes list. Then add the `:root[data-theme="blossom-night"]` block, with `color-scheme: dark`.
3. **Registrations.** First failing tests, each listing the new id: `themeBoot.test.ts` (stored `blossom-night` boots as itself), `nativeWindow.test.ts` (`blossom-night` is dark, not in `LIGHT_THEMES`), `monacoTheme.test.ts` (`blossom-night` maps to `vs-dark`). Then: add the id to the `ThemeName` union in `theme.ts` and its Monaco mapping; to the list in `windowSyncApply.ts`; the boot colour `"blossom-night":"#1d1520"` in `index.html` (also wherever the boot script is generated, check `themeBoot.test.ts`); the Settings entry in `Settings.tsx` (`{ id: "blossom-night", label: "Blossom Night", hint: "Dark · soft pink", swatch: ["#1d1520", "#251a29", "#f28bb5"] }`, built with `ChoiceCard`); `THEMES` in `scripts/theme-audit/theme-audit.mjs`; and the native title bar mapping in `desktop/src-tauri/src/window_theme.rs` if it lists themes.
4. **Theme audit.** First failing test: the audit script's theme count (or `themeTokens` count) expects 14. Run `scripts/theme-audit` and fix any component whose text run fails in Blossom Night.
5. **Attribution.** First failing test: a small test (next to `themeTokens`) that `THIRD_PARTY_NOTICES.md` exists and names both projects when a theme block carries the credit comment. Then add the file and comments (section 4).
6. **Website docs.** First failing test: `website/src/lib/docs.test.ts` stays green only if links resolve; the visible check is editing `website/src/content/docs/settings.md` to list Blossom Night under the themes ("Soft and light: Blossom ... Soft and dark: Blossom Night, ...") and, if the owner moves any danger colour, say so. Run `cd website && npm test && npm run build`.
7. **DESIGN_SYSTEM.md.** Update "13 themes" to 14 (lines 7, 53, 144, 146, 190) and the `CLAUDE.md` design-system rule says "all 12 theme blocks", which is already out of date (it is 13); fix that too if the owner agrees. Then re-sync the design system artifact (https://claude.ai/artifact/J35D45QQ7X6Sgd7mwfRSnF) after merge.
8. **CHANGELOG and what's-new.** Entry for Blossom and Blossom Night (the generated `whatsnew.json` already mentions Blossom).

First Rule check (speed, no hang, no error):
- Runtime cost: none added. Themes are CSS custom properties on `:root[data-theme]`; no JS colour computation, no extra network, no new asset. The only runtime code is two list entries.
- No layout shift on switch: a theme changes colours and shadows only, never sizes, fonts or spacing, so it cannot move layout. Add a test that the new block declares no `--kb-space-*`, `--kb-h-*` or `--kb-text-*` token.
- Instant switch: the `data-theme` attribute swap repaints in the same frame. The boot script in `index.html` sets the colour before first paint, so a stored `blossom-night` does not flash another theme (covered by `themeBoot.test.ts`).
- No error path: an unknown stored id already falls back to the default theme.

## 7. Open questions for the owner

1. Is the honest reference ("Rosé Pine for structure, not the most-used pink theme, since none can be verified") acceptable? Recommendation: yes. If you want the claim settled, paste marketplace counts for Pink Cat Boo and any other pink theme you have in mind and I will re-rank.
2. Ship Blossom Night now, or Blossom alone? Recommendation: ship both. Rosé Pine ships light and dark, and a pink light theme is a poor fit for people who work in dark rooms.
3. Name: "Blossom" and "Blossom Night"? Recommendation: keep them; they say what they look like and carry no third-party name.
4. Add an HC pink variant? Recommendation: not now; the editor themes are held at 4.5:1 and only the two native themes have HC. Revisit if users ask.
5. Attribution wording: "inspired by Rosé Pine" in the public docs, or only the notices file? Recommendation: notices file plus the tokens.css comment, with no public "inspired by" line, so we imply no endorsement.
