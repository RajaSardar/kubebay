# Social drafts

> Post these a few hours *after* the Show HN, and link the HN thread from at least one of them. Every post gets an image or GIF; posts without media get a fraction of the reach. Put them in your own voice.

## X / Bluesky thread (5 posts)

1. Lens wants an account. The Kubernetes Dashboard was archived. So I built a free, local-first Kubernetes IDE.

   Kubebay: Go engine, Tauri app, MIT. No account, no telemetry.
   🧵 [media/kubebay-tour.gif]

2. Every view is a live watch stream. One Go process watches each cluster once and streams changes over one WebSocket, so there's no Refresh button anywhere.

   Budgets measured in CI on every PR: ≤150 MB idle, ≤1.5 s cold start. [media/workloads.png]

3. The part I care about most: it tells you what's fragile.
   - single points of failure
   - NetworkPolicy gaps + "can A reach B?"
   - attack paths: exposed → vulnerable → over-privileged
   - requests vs. real usage
   [media/workloads-overview-spof-radar.png]

4. It also does Helm, Argo CD and Flux drift, KEDA, Karpenter and port-forwards, plus an MCP server (off by default) so Claude can read the clusters you pick and propose changes you approve one by one. [media/rbac.png: attack paths; an MCP approval clip is still to record]

5. It's v0.7, built by one person (with a lot of Claude Code). I'd love bug reports from real clusters.
   ⭐ github.com/RajaSardar/kubebay
   📖 kubebay.sardar.dev/docs
   HN thread: [link]

**Hashtags (sparingly, one or two):** `#kubernetes` `#k8s` `#devops` `#opensource`. On Bluesky, add it to any Kubernetes or cloud-native feeds you follow. On X, tag `@kubernetesio` / `@CloudNativeFdn` only if the post is genuinely relevant to them; don't spam-tag.

## Mastodon (hachyderm.io / fosstodon.org)

One post, a bit more technical. The fediverse responds to open source, no-telemetry and not-a-startup:

> I built Kubebay, a free (MIT) Kubernetes desktop client with no account and no telemetry. Go engine with shared informers, a Tauri shell, ≤150 MB idle. Beyond the usual tables, logs and exec, it flags single points of failure, NetworkPolicy gaps and attack paths from the internet to risky RBAC. v0.7, solo project, feedback very welcome.
> https://github.com/RajaSardar/kubebay
> #kubernetes #k8s #opensource #golang #tauri

Add alt text to every image.

## LinkedIn (T-3 days, to your network, then again on launch day)

> For the past few months I've been building something on nights and weekends: **Kubebay**, a free, open-source Kubernetes IDE.
>
> Why: Lens moved to accounts and subscriptions, the official Kubernetes Dashboard was archived this year, and the teams I work with needed a GUI that's safe to hand to anyone. It runs locally, needs no account and sends no telemetry.
>
> What makes it different is that it doesn't just show your cluster. It tells you what's fragile: single points of failure, network policy gaps, risky RBAC permissions, and wasted CPU and memory.
>
> It's MIT licensed and still early (v0.7). If you run Kubernetes, I'd be grateful if you tried it and told me what's missing.
>
> 🔗 https://kubebay.sardar.dev
>
> #Kubernetes #DevOps #PlatformEngineering #OpenSource #SRE

LinkedIn tends to reach more people when the link goes in the first comment rather than the post. Test both.

## Ongoing (after launch week): one post a week

A cadence beats a single burst. Ideas, each with a GIF:

- "Feature of the week": one analysis view and the real problem it catches
- "From an issue to a fix in a day": credit the reporter
- Release notes highlights
- Milestones (first external contributor, 100 stars), framed as thanks, not boasting
- Short engineering notes: Tauri + Go sidecar, informer memory, keeping a design system honest with contrast tests
