# Kubebay launch kit

> **Status:** drafted 2026-11-08, nothing published yet. This is the working plan for [KB-06](../BACKLOG.md).
> Every post here is a draft for Raja to edit **into his own voice** and publish from his own accounts. Nothing in this folder posts itself.

## Where things stand (checked 2026-11-08)

| Signal | Now | KB-06 30-day target |
|---|---|---|
| GitHub stars | 1 | ≥ 500 |
| Forks | 1 | — |
| v0.7.0 downloads (all assets) | 55 | ≥ 50 / week |
| Issues from people other than Raja | ~0 | ≥ 10 |
| Repo topics | none | 10+ set |
| Repo "Website" field | empty | `https://kubebay.sardar.dev` |
| GitHub Discussions | off | on |
| Screenshots / GIF / video anywhere | **none** | README hero GIF + 60 s video |

**Takeaway:** the bottleneck is distribution and proof, not features. Kubebay already has ~35 documented feature areas. Hardly anyone has seen it, and there isn't one picture of it online.

## Research findings that shape the plan

1. **Show HN is the best single channel for an open-source dev tool**, if the post is plain, technical and free of marketing language, needs no signup, links the repo, and the maker answers comments all day. Visibility is fragile: posts get pushed down quickly, and a post with no comments may simply have gone unseen, not been judged bad. That argues for a second attempt weeks later with a different angle, not for giving up. ([dev.to launch guide](https://dev.to/lightningdev123/beyond-product-hunt-a-technical-launch-guide-for-2026-i2j), [CodeYam postmortem](https://www.producthunt.com/p/general/what-i-learned-launching-codeyam-cli-memory-on-show-hn-and-product-hunt))
2. **r/kubernetes is tired of "AI-slop repos".** In 2026 there have been repeated complaints that the sub is overrun with them, and moderators are under pressure to tighten up ([Jan 2026 snapshot](https://reddit.sentinel-team.org/subreddits/kubernetes/snapshots/2026-01-21T21%3A30%3A17.115876Z), [Mar 2026 snapshot](https://reddit.sentinel-team.org/subreddits/kubernetes/snapshots/2026-03-13T10%3A02%3A59.030795Z)). This repo has a `CLAUDE.md` and AI co-authored commits, and people will notice. **Say it first and say it plainly** ("built by one person with heavy AI assistance, here is how the tests and CI keep it honest"). Getting caught hiding it is fatal; saying it up front is often respected. The post must read as written by a person: short, specific, with a real story.
3. **The market gap is real and documented by third parties.** The Kubernetes Dashboard was archived on 2026-01-21 and SIG UI points to Headlamp ([dev.to](https://dev.to/alexandrev/kubernetes-dashboard-alternatives-in-2026-best-web-ui-options-after-official-retirement-4e02)). Roundups recommend Freelens as the "lowest-risk" desktop choice, and Lens is proprietary with a limited free tier ([computingforgeeks](https://computingforgeeks.com/best-kubernetes-ui-management-tools/), [krust](https://krust.pages.dev/docs/kubernetes-dashboard-alternative)). **Kubebay isn't in any of these roundups yet.** Getting into them is a direct, durable channel (see [directories.md](directories.md)).
4. **Product Hunt is a weak channel for infra tools.** Even teams with large open-source communities found it took far more effort than expected, and dev tools need deeper engagement than the average PH visitor gives ([Daytona](https://www.daytona.io/dotfiles/how-we-missed-1-on-product-hunter-but-still-won-big), [Peerlist](https://peerlist.io/arindam1729/articles/lessons-learned-from-helping-devtools-succeed-on-product-hun)). Do it, but second, and don't measure the launch by it.
5. **The CNCF Landscape generally includes projects with ≥ 300 stars** ([cncf/landscape](https://www.github.com/cncf/landscape)). Filing at 1 star wastes a reviewer's goodwill. It's a **post-launch milestone**, not a launch channel. [cncf-landscape.md](cncf-landscape.md) has the ready PR.
6. **Newsletters take submissions:** CNCF **KubeWeekly** (Fridays, via the form linked from [cncf/foundation KubeWeekly.md](https://github.com/cncf/foundation/blob/master/KubeWeekly.md)) and **Learnk8s** (Sundays, "Submit a link" at [learnk8s.io/newsletter](https://learnk8s.io/newsletter)). Both want an *article*, not a product page. Submit the launch blog post, not the repo.
7. **The positioning in the analysis holds:** lead with what no competitor ships (SPOF radar, NetworkPolicy reachability, attack paths, waste/right-sizing, upgrade readiness), and use "free, local, no account, MIT" as the reason to believe ([COMPETITIVE_ANALYSIS.md](../COMPETITIVE_ANALYSIS.md) §3.6). The current website feature grid lists only commodity features (live tables, Helm, port-forward…). **Fix that before launch.**

## Gate: do these before anything is posted

These are ordered by how badly each one hurts if it's missing on launch day.

| # | Item | Why | Who / how |
|---|---|---|---|
| G1 | **README hero GIF + 4 feature GIFs** (Overview with SPOF radar, NetworkPolicy reachability, attack paths, Cost/Waste) and a 60 s video | Every channel rewards visuals, and a K8s UI with no screenshot gets scrolled past. HN readers click the repo, and the first screen decides the star. | Record on a kind cluster seeded with a demo app. Use [Kap](https://getkap.co) or `ffmpeg`, keep each GIF ≤ 5 MB, and put the video on YouTube for embeds. |
| G2 | **macOS Developer ID signing + notarization (KB-03)** | The README tells users to run `xattr -dr com.apple.quarantine`. "Bypass Gatekeeper for a tool that holds your prod kubeconfig" will be the top HN comment. | $99/yr Apple Developer account, then the secrets in `release.yml`. If this can't land first, address it head-on in the post (see the HN draft). |
| G3 | **Repo metadata** | Topics are how GitHub search and "Explore" find repos. | Settings → About: Website `https://kubebay.sardar.dev`; topics `kubernetes, kubernetes-ide, k8s, lens-alternative, kubernetes-dashboard, devops, tauri, golang, react, desktop-app, sre, platform-engineering, mcp`. Upload a 1280×640 social preview image (Settings → General → Social preview); without one every share shows a blank card. |
| G4 | **Turn on GitHub Discussions** | Launch-day questions need a home that isn't an issue. | Settings → Features → Discussions. Seed one "Welcome / roadmap feedback" thread and one "Show us your setup" thread. |
| G5 | **Refresh the website feature grid** (`website/src/components/Features.astro`) | It undersells the product: no SPOF radar, attack paths, waste, NetworkPolicy, MCP, Argo CD/Flux. | A separate PR, done through the design system and docs rules. |
| G6 | **A "good first issue" set** | Launch traffic converts to contributors only when there's a door. | Label 5–10 small, real issues. |
| G7 | **Clear inbox + launch day blocked out** | HN and Reddit rank posts partly on early comment engagement. | Answer every comment within ~15 min for the first 6 hours. |

## Sequence

One big wave, then a long tail. Don't post everywhere in the same hour: you can't answer everyone, and an unanswered thread dies.

| When | Channel | Draft |
|---|---|---|
| **T-7 days** | G1–G7 done. Publish the launch blog post on `kubebay.sardar.dev` (or dev.to) so there's an article to link. | [blog-post.md](blog-post.md) |
| **T-3 days** | Personal network: LinkedIn post to ex-colleagues, DMs to 10–20 people who run clusters, asking for honest feedback (not stars). | [social.md](social.md) |
| **Day 0 (Tue–Thu, ~8–9 am US Eastern)** | **Show HN** | [show-hn.md](show-hn.md) |
| Day 0, +4 h | X / Bluesky / Mastodon thread linking the HN post | [social.md](social.md) |
| **Day 1** | **r/kubernetes** (one post, a weekday morning US time) | [reddit.md](reddit.md) |
| Day 2–3 | r/devops; r/sre; r/homelab or r/k3s (framed for small clusters) | [reddit.md](reddit.md) |
| Day 3 | Submit the blog post to KubeWeekly + Learnk8s; cross-post to dev.to / Hashnode / Medium (canonical URL set to the original) | [blog-post.md](blog-post.md), [directories.md](directories.md) |
| Week 1 | Directories and lists: AlternativeTo, awesome lists, Artifact Hub (Helm chart), roundup authors | [directories.md](directories.md) |
| Week 2 | **Product Hunt** (Tuesday–Thursday, 12:01 am PT) | [directories.md](directories.md) |
| Week 2–4 | Package managers (winget, AUR, Flathub, Scoop), Kubernetes Slack, podcasts, YouTubers | [directories.md](directories.md) |
| Week 4+ | Second wave: a deep-dive post on one unique feature ("How Kubebay finds single points of failure"), a **second Show HN only with a substantially new release** (HN allows a repost for a significant update) | — |
| ≥ 300 stars | CNCF Landscape PR | [cncf-landscape.md](cncf-landscape.md) |
| Next CFP | KubeCon / KCD / Cloud Native Rejekts talk: "What the archived Dashboard taught us about K8s UIs" | [directories.md](directories.md) |

## Rules for every post

- **Be honest about what it isn't yet:** solo maintainer, v0.x, Windows and Linux in Preview, macOS not yet notarized (until KB-03). Those caveats buy trust.
- **No vote or star begging.** HN penalises vote rings, and Reddit bans them. Ask for *feedback* and *bug reports*.
- **Never post the same text twice.** Each subreddit gets its own angle.
- **One link per post, to the repo** (on Reddit put install steps in a comment, not the body).
- **Track it:** add `?ref=hn`, `?ref=reddit` and so on to website links (not repo links), and log stars/downloads daily in a sheet for the 30-day review.

## 30 days after launch

Compare against the KB-06 targets. If they're missed, run the positioning retro the backlog calls for **before** starting more Next-horizon feature work.
