# Info buttons: research

Root `BACKLOG.md` #18: "do an indepth research and find if we need to add info small button on each feature on hover of each it should explain what is it and how this feature works".

## Verdict

**Yes, add them, but one per feature, not one per control, and opened by a click or tap rather than only by hover.**

- One **ⓘ** beside each page's title, and beside each insight card's title, such as SPOF Radar, Attack paths and Efficiency score. About 25 pages and 20 cards.
- It opens a short panel with **what it is** (one sentence), **how it works** (one sentence: where the data comes from, and what the cluster needs), and **Learn more →** to that page of the [user manual](https://kubebay.sardar.dev/docs/).
- It opens on click, tap, <kbd>Enter</kbd> or <kbd>Space</kbd>. It stays open until you press <kbd>Esc</kbd>, click elsewhere or click it again.
- Not on columns, buttons or menu items. Those keep their labels, and native `title=` text where a cell is truncated.

## What Kubebay has today

- **No tooltip or popover in `@kubebay/ui`.** Help is scattered across two forms.
- **About 70 native `title=` attributes** in the shell. They appear on mouse hover only. Keyboard and touch users never see them, and screen readers read them inconsistently.
- **Inline explanations on some pages.** Flux explains why it has no diff view, and Settings cards explain what each feature sends. Others explain little: what SPOF Radar flags, how the Efficiency score is weighted, or that Upgrade Readiness reads discovery data rather than objects. The [manual](https://kubebay.sardar.dev/docs/) now has those answers, but nothing in the app points to them.

So the gap is real: the "what is this and how does it work" knowledge exists, in the docs, but the app gives no way to reach it from the feature itself.

## What the guidance says

- **Tooltips are for brief, supplemental help, never for what you need to finish a task.** NN/g: "Don't use tooltips for information that is vital to task completion." Kubebay's essential notices stay as visible text, such as "Trivy-Operator not detected" and "This change looks risky". The ⓘ only explains. ([NN/g, Tooltip guidelines](https://nngroup.com/articles/tooltip-guidelines))
- **Info tips are often overused and bloated.** NN/g's article on info tips warns about exactly that, and about tips that hide essential instructions. One per feature, one or two sentences, keeps them from becoming noise. ([NN/g, Info tips](https://www.nngroup.com/articles/info-tips-bad/))
- **Use them sparingly.** Microsoft's Windows guidance calls tooltips an interruption, "as distracting as a pop-up". Don't repeat visible text. ([Microsoft Learn, Tooltips](https://learn.microsoft.com/windows/apps/develop/ui/controls/tooltips))
- **A panel with a link is a toggletip, not a tooltip.** Carbon: a tooltip appears on hover or focus and isn't interactive. A toggletip opens on click or <kbd>Enter</kbd>, uses an info icon button that's in the tab order, and closes on <kbd>Esc</kbd>. A **Learn more →** link makes the panel interactive, so it must be a toggletip. ([Carbon, Toggletip](https://carbondesignsystem.com/components/toggletip/usage/), [accessibility](https://carbondesignsystem.com/components/toggletip/accessibility/))
- **Hover-only fails touch and keyboard.** Hover-only tips are unusable on touchscreens and must also open on keyboard focus. WCAG 1.4.13 requires content shown on hover or focus to be dismissible, hoverable and persistent. ([Userlytics](https://www.userlytics.com/resources/glossary/tooltip/), [Pearson accessibility library](https://accessibility.pearson.com/resources/component-library/tooltips-and-toggletips))
- **Developer tools do this already.** Grafana puts an ⓘ on a panel whose description, in Markdown with links, explains the panel. ([Grafana docs](https://grafana.com/docs/grafana-cloud/visualizations/panels-visualizations/configure-panel-options/)) The search found no documented equivalent in Headlamp, Lens or Freelens, so this would set Kubebay apart from them.

## Options

| | What | For | Against |
|---|---|---|---|
| A | A hover tooltip on every feature and control, as the backlog item says | Help everywhere; no click | Hover-only fails touch, keyboard and WCAG 1.4.13; dozens of icons crowd dense tables; tooltips can't hold a link to the manual; overuse is the failure NN/g warns of |
| **B** | **An ⓘ toggletip per page and insight card, linking to the manual** | **Reaches every user; one place per feature; links the app to the docs; small, testable surface** | **One click instead of a hover** |
| C | Nothing: rely on the manual and the command palette | No work | The question "what is this?" comes up on the page itself, not in a browser tab |

**B**, because it answers the backlog item's real need (explain each feature, and how it works) without A's accessibility and clutter costs. The one change from the item as written is "on hover": hover-only would hide the help from keyboard and touch users. The ⓘ also shows a "What is this?" label on hover, so pointer users still discover it by hovering.

## How it would be built

1. **`HelpTip` in `@kubebay/ui`**, per the design-system rule.
   - An icon button with `aria-expanded` and `aria-controls`, and a non-modal panel.
   - Closes on <kbd>Esc</kbd> and on outside press, and returns focus to the button.
   - `--kb-*` tokens only, so all 12 themes pass the contrast test.
   - `PageHeader` gets a `help` prop. Cards get the same.
2. **One registry, `lib/help.ts`**, keyed by route, then card. Each entry has `what`, `how` and `docs` (a manual slug and anchor). Copy lives in one place, not in 45 components.
3. **A guard test** beside the docs guard: every route in `App.tsx` has a help entry, and every entry's `docs` slug exists in `website/src/content/docs`. A new page then can't ship without its ⓘ, or link to a page that isn't there.
4. **Rollout in three PRs**:
   1. the component and its tests;
   2. every page header;
   3. the insight cards on Overview, RBAC and Cost / Waste.

   Then the design-system artifact gets re-synced, per CLAUDE.md.

Out of scope: replacing the existing `title=` attributes. Most of them label truncated cells, which is the one place a hover title is the right tool.

## Open question for the decision

Click (recommended), or hover *and* click? Hover-to-open can meet WCAG 1.4.13 if the panel stays open while hovered and closes on <kbd>Esc</kbd>. But it adds accidental pop-ups in dense tables, and NN/g's research counts those against info tips.
