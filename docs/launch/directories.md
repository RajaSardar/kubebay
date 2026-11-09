# Every other place to list and announce Kubebay

> Grouped by type, with the priority order inside each group. "Verify" means I couldn't confirm the current submission process on 2026-11-08: check the site's own rules before you submit.
> Tick each one off in the Status column as you go, so this file becomes the launch log.

## 1. Owned channels (do first: they're where every other link lands)

| Where | What to do | Status |
|---|---|---|
| GitHub repo | Gate items G1, G3, G4, G6 in [README.md](README.md): GIFs, topics, website field, social preview image, Discussions, good-first-issues | ☐ |
| GitHub Release v0.8 notes | Write them as an announcement: what's new, one GIF, install line. Release notes are what watchers and newsletters read. | ☐ |
| kubebay.sardar.dev | Refresh the feature grid (G5). Add the launch blog post. Make sure Open Graph tags render a real image (`SEO.astro`). | ☐ |
| Pinned GitHub Discussion | "Kubebay v0.8: launch thread", the same body as the blog post | ☐ |
| `FUNDING.yml` | Already lists GitHub Sponsors. Make sure the Sponsors profile is actually set up before launch day. | ☐ |

## 2. Launch-day communities

| Where | Notes | Draft | Status |
|---|---|---|---|
| **Hacker News (Show HN)** | Day 0. The single highest-leverage post. | [show-hn.md](show-hn.md) | ☐ |
| **r/kubernetes** | Day 1 | [reddit.md](reddit.md) | ☐ |
| r/devops, r/sre, r/homelab / r/k3s | Days 2–4, one per day | [reddit.md](reddit.md) | ☐ |
| **Lobsters** (lobste.rs) | Invite-only; ask someone who has an account. Tag `show`, `devops`. Authors must disclose that it's their own project. | Reuse the HN text, shorter | ☐ |
| **Kubernetes Slack** (slack.k8s.io) | Verify which channel allows project announcements. Never cross-post to many channels; one post in the right place. | Social short version | ☐ |
| **CNCF Slack** (slack.cncf.io) | Same rule: verify the channel. | Social short version | ☐ |
| DEV Community, Hashnode, Medium | Cross-post the blog article with the canonical URL set to the original. Tags: `kubernetes`, `devops`, `opensource`, `go`. | [blog-post.md](blog-post.md) | ☐ |
| X, Bluesky, Mastodon, LinkedIn | Threads and posts | [social.md](social.md) | ☐ |

## 3. Newsletters (submit the *article*, not the repo)

| Newsletter | How | Status |
|---|---|---|
| **KubeWeekly** (CNCF, Fridays) | The submission form linked from [cncf/foundation KubeWeekly.md](https://github.com/cncf/foundation/blob/master/KubeWeekly.md) | ☐ |
| **Learnk8s** (Sundays) | "Submit a link" at [learnk8s.io/newsletter](https://learnk8s.io/newsletter) | ☐ |
| DevOps Weekly, SRE Weekly, Golang Weekly, Console.dev, TLDR DevOps | Verify each one's submission method (usually an email to the editor or a form). Console.dev specifically reviews new dev tools. | ☐ |
| Changelog News | Submit at changelog.com (verify the "submit news" link) | ☐ |

## 4. Directories, roundups and "alternatives" sites (durable, long-tail search traffic)

| Where | Notes | Status |
|---|---|---|
| **AlternativeTo** | Add Kubebay as an alternative to Lens, Freelens, Headlamp, k9s, Kubernetes Dashboard and Aptakube ([Headlamp's page](https://alternativeto.net/software/headlamp/)). People search "Lens alternative" and land here. | ☐ |
| **Awesome lists** (a PR each, follow their format) | [ramitsurana/awesome-kubernetes](https://github.com/ramitsurana/awesome-kubernetes) (accepts tool PRs, e.g. kftray #914). Also search GitHub for `awesome-kubernetes`, `awesome-k8s`, `awesome-tauri`, `awesome-go` (strict quality bar, verify), `awesome-mcp-servers` (for the MCP server), `awesome-selfhosted` (verify fit). | ☐ |
| **Roundup authors** | Kubebay is missing from the 2026 "Lens/Dashboard alternatives" pieces: [computingforgeeks](https://computingforgeeks.com/best-kubernetes-ui-management-tools/), [dev.to (alexandrev)](https://dev.to/alexandrev/kubernetes-dashboard-alternatives-in-2026-best-web-ui-options-after-official-retirement-4e02), [ITNEXT](https://itnext.io/best-alternatives-for-the-top-kubernetes-ide-you-need-to-know-of-87a2cefe2daa). Send each author a short, polite note with a GIF and one line on what's different. Ask to be considered, not added. | ☐ |
| **Artifact Hub** | List the Helm chart in `charts/kubebay` (add a repository on artifacthub.io). That's where people look for in-cluster tools. | ☐ |
| **Product Hunt** | Week 2, Tue–Thu at 12:01 am PT. Tagline: "Free, local-first Kubernetes IDE. No account." Gallery: the GIFs plus a 60 s video. A maker comment like the HN one. Don't measure the launch by its rank. | ☐ |
| Others | OpenAlternative.co (open-source alternatives to SaaS), LibHunt, StackShare, SaaSHub, Uneed, DevHunt (dev-tool-focused PH alternative). Verify each before submitting. | ☐ |
| MCP registries | The official MCP Registry, and directories such as mcp.so, Glama and Smithery (verify which accept a server that ships inside a desktop app) | ☐ |

## 5. Package managers (discovery *and* trust)

| Where | Notes | Status |
|---|---|---|
| Homebrew tap | Already exists (`rajasardar/tap`). Once notarized and somewhat popular, consider submitting the cask to `homebrew/cask` (it has notability requirements; verify them). | ☐ |
| **winget** | PR a manifest to `microsoft/winget-pkgs` for the `x64-setup.exe` | ☐ |
| Scoop | Add a manifest to the `extras` bucket (verify the criteria) | ☐ |
| **AUR** | A `kubebay-bin` PKGBUILD from the AppImage or .deb | ☐ |
| Flathub | Larger effort (sandboxing a kubeconfig reader). Later. | ☐ |
| Docker Hub / GHCR | Publish the engine image with a good README. It shows up in Docker Hub search. | ☐ |
| Nix (nixpkgs) | Community-driven; a `good first issue` for a contributor | ☐ |

## 6. People with an audience (week 2+, after there's traction to point at)

Write each one a personal note. Never send a mass email.

| Who | Why | Status |
|---|---|---|
| Kubernetes Podcast from Google (Abdel Sghiouar, Kaslin Fields) | Biweekly community show ([listing](https://www.podengine.ai/podcasts/kubernetes-podcast-from-google)); a fit once there's a story (the Dashboard archive, local-first) | ☐ |
| DevOps Toolkit (Viktor Farcic), Rawkode Academy, TechWorld with Nana, Kubesimplify | They review K8s tools on YouTube. Offer a 15 min demo call. (Verify current activity.) | ☐ |
| The Cloudcast, Kubernetes Bytes and similar podcasts | Guest pitch: "what the archived Dashboard taught me about K8s UIs" | ☐ |
| Rancher community | The "best client for Rancher-managed clusters" channel (COMPETITIVE_ANALYSIS §3.6, KB-08): a SUSE community forum post or blog guide once KB-08 lands | ☐ |

## 7. Talks and events

| Where | What | Status |
|---|---|---|
| KubeCon + CloudNativeCon CFPs | Talk: "Your cluster's single points of failure, found from the API alone", or a lightning talk on the Dashboard archive | ☐ |
| KCDs (Kubernetes Community Days) | Smaller and easier to get into; same talk | ☐ |
| Cloud Native Rejekts | Talks rejected by KubeCon; good for a solo maintainer | ☐ |
| Local meetups | A 10-minute demo at a CNCF meetup near you (community.cncf.io) | ☐ |

## 8. Later milestones

| Milestone | Trigger |
|---|---|
| **CNCF Landscape** PR | ≥ 300 stars ([guideline](https://www.github.com/cncf/landscape)). Ready-to-file PR: [cncf-landscape.md](cncf-landscape.md). Set `homepage_url` to `https://kubebay.sardar.dev`. |
| Second Show HN | A substantially new release (signed + auto-updating v0.8, or MCP propose/approve) |
| CNCF Sandbox application | Several maintainers from more than one organization: a long way off, but worth knowing it's the path |
