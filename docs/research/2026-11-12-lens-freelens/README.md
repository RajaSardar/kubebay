# Kubebay vs Lens vs Freelens: feature research, 2026-11-12

How the website's "Where Kubebay goes further" table was checked. Every claim about another tool traces to a page someone read on the day above.

| File | What it is |
|---|---|
| [verdict.md](verdict.md) | **Start here.** The cross-checked result: 17 disagreements between the reports and how each was settled, a row per feature with safe public wording and a confidence, the rows that are publishable, what needs a person to check the real apps, and the fixes Kubebay's own docs needed. |
| [inventory.md](inventory.md) | The 78 Kubebay features (F01–F78) everyone worked from. |
| [lens-a.md](lens-a.md), [lens-b.md](lens-b.md) | Lens, items F01–F40 and F41–F78: status, plan, URL and a short quote for each. |
| [freelens-a.md](freelens-a.md), [freelens-b.md](freelens-b.md) | Freelens, the same split. Freelens has no user manual, so the evidence is its releases, source, official extensions and issues. |
| [kubebay.md](kubebay.md) | A code audit: does Kubebay really ship each item, with file and line, tests, and which claims to soften. |

## Method

1. A numbered inventory of Kubebay's features, built from its manual.
2. Four researchers read Lens's and Freelens's own pages (Lens: its docs sitemap, pricing and release notes; Freelens: every release, the README, the organisation's repositories and marketplace) and one auditor read Kubebay's code. Each wrote a status, a URL and a quote per item.
3. A separate reviewer was told to cross-challenge the five reports, re-read the contested sources itself and re-check the most serious Kubebay findings in code. Where the reports disagreed, the reviewer's re-read of the primary source decided.

## Rules the wording follows

- Another tool is **"not documented"** or described by what its own pages say, never "lacks". A missing page is not a missing feature.
- Lens's documentation lists a details panel's actions but not its tabs, so nothing here claims what a Lens panel does or doesn't show.
- Freelens ships extensions in the `freelensapp` organisation (Resource Map, Karpenter, Flux CD, AI, AgentBridge, GPU). A feature one of them provides is not called missing.
- No performance figure is claimed for any tool.

## Limits

Neither app was launched. Anything marked LOW confidence, or listed under "Items that need a human to check the real app" in `verdict.md`, is a documentation reading only. Lens's pricing and docs change; every cell carries its check date.
