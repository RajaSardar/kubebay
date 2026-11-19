# Helm Charts as a store

Backlog #11: "Helm Charts should be like a store, do launch lots of innovative experts agents and do unfiltered debate and decide how it should be."

- **Status:** Decided, first slice built (2026-11-18).
- **Related:** [ADR 0004](adr/0004-helm-releases-load-and-details.md) (releases), [docs/AIRGAP.md](AIRGAP.md), the engine's `netguard` package.

## 1. What exists today (audit)

The Helm page (`web/apps/shell/src/pages/Helm.tsx`) has two tabs, **Releases** and **Charts — install**. The second is `ChartsTab` in `components/HelmCharts.tsx`.

What the Charts tab already does:
- Lists the repos in the machine's own Helm config (`GET /api/helm/repos`), one repo or **All repos**, with a name and description search and **Update indexes** (`POST /api/helm/repos/update`, which refuses repo URLs that point at metadata or link-local addresses).
- Shows each chart as a card: name, latest version, description, app version, "N versions".
- Clicking a card opens a drawer with a release name, namespace and version box, the chart's default `values.yaml` in an editor, and **Install**. That calls `POST /api/helm/upgrade`, which installs or upgrades by whether the release exists, runs as the signed-in identity and is audited.

What the engine already has and the UI doesn't use:
- `dryRun: true` on `/api/helm/upgrade` (client-side render only, never touches the API server). Nothing in the UI sends it.
- `POST /api/helm/repos/add` (SSRF-checked, validates by fetching the index). The UI tells you to run `helm repo add` in a terminal.

What is missing for it to feel like a store:
- No chart page: no versions list, README, maintainers, home or source links, keywords.
- No sign of what is already installed; install and upgrade look the same and you can't see "this is already on the cluster".
- No preview before applying; no diff against what is running.
- A chart's archive is fetched by Helm's own getters, not the guarded transport the index uses. A repo's index may name any URL for an archive, so a hostile or compromised repo could make the engine fetch a metadata address. That is a real gap, found in this audit.
- A dry-run or install response carries the rendered manifest with Secret values in it (the Manifest tab masks them; this path didn't).

## 2. The debate

Four advocates. Round 1 each proposes; round 2 each must attack another's proposal and concede or sharpen their own.

### Round 1: proposals

**Platform engineer (Priya).** "A store is a catalogue plus lifecycle. Cards with search and filters, a chart page with versions, README, values and maintainers, then install and upgrade from it with a values editor, and a diff against what's running before I apply. Add a repo from the UI. Show 'installed' on a card so I know whether I'm about to install or upgrade. I'd also want Artifact Hub search so I can find charts in repos I haven't added."

**Security reviewer (Marcus).** "A store means the engine downloads and renders third-party code on your say-so, as you. So: nothing new fetched by an unguarded client; the index is untrusted input, so archive URLs get the same SSRF check as repo URLs; nothing from a chart rendered as HTML; no secret values in a preview. Show provenance if the chart is signed. And an 'add repo' button is a trust decision, so it must say what it will do. Artifact Hub means the engine calls a third party and shows its popularity ratings and 'verified publisher' badges as if they were security signals. They aren't. I'd not do it."

**Product designer (Noor).** "A store is browsing: scannable cards, an icon, a clear 'Installed' state, chart pages that answer 'what is this, which version, who maintains it, what will it make' before the install form appears. The install form should come last, not first. Previewing what you're about to create is the 'checkout' step. Icons make a grid readable, but `icon:` is a URL, so the browser would load images from arbitrary hosts."

**Lazy on-call engineer (Sam).** "At 3 a.m. I need to upgrade one chart safely. I don't browse. Smallest thing: on a chart, tell me what's installed, let me pick the version, show me the diff against what's running, and apply. Everything else (Artifact Hub, ratings, categories, add-repo form, icons) is a later quarter. And don't build a second install flow: reuse the release flow that's audited and tested."

### Round 2: cross-challenge

**Marcus challenges Priya.** "Artifact Hub search is a feature that sends every search term to a third party from an engine that may run in-cluster or air-gapped (docs/AIRGAP.md), and it puts unvetted repos one click from 'add and install'. 'Find charts in repos I haven't added' is exactly the supply-chain path I'm paid to close." **Priya concedes** the in-cluster and air-gapped point and drops Artifact Hub from the first slice, but holds that a later opt-in, off by default, behind the same guarded client, is a fair store feature. Sharpened: repos stay what the user configured.

**Priya challenges Sam.** "'Diff against what's running' needs the release's manifest and a render. If the diff is a toy, people stop trusting it. And your 'no browse' stance is how you ship a page that's a form, not a store." **Sam concedes** browsing stays (it already exists as cards) but holds the line on size: the diff reuses `dryRun` and the existing manifest endpoint, so it is one component, not a new subsystem. Sharpened: the diff compares the *rendered* manifests of the running revision and the preview, not values.

**Noor challenges Marcus.** "If the README can't be rendered, you've made the chart page worse than the GitHub page the user will open instead. Plain text of Markdown is unreadable." **Marcus holds**: a Markdown renderer is new attack surface (raw HTML, `javascript:` links, remote images that phone home) and the project has none vetted. **Noor concedes** for the first slice: README as preformatted text, with a note that rendering is deferred until a sanitizing renderer is chosen; home and source links open in the user's own browser.

**Sam challenges Noor.** "Icons: you want the shell to load images from any host a repo names? That's a request to a stranger's server for every card, and it breaks air-gapped." **Noor concedes** icons out; cards stay text. She keeps one thing: the *Installed* badge, since it is the one visual that changes a decision.

**Marcus challenges Sam.** "Your 'reuse the release flow' is right, but the preview response carries the rendered manifest. Secret values (including ones a chart generates) would reach the browser. And the archive fetch has the SSRF gap." **Sam concedes both** and they become part of the slice, with tests first: archives from an index are checked and fetched through the guarded transport, and install, upgrade and preview responses mask Secret values like the Manifest tab does.

**Sam challenges Priya on add-repo.** "Add-repo from the UI is a mutation that writes the user's `repositories.yaml`, unaudited today." **Priya concedes**: not in this slice; the empty state keeps saying `helm repo add`.

### Verdict

The smallest valuable store slice is the **chart page and a safe install path**, not a new catalogue:

1. **Chart page.** Clicking a card opens a drawer with versions (from the repo index, so no download to list them), the chosen version's README (plain text), maintainers, home and source links, keywords, deprecation. The values editor and install form stay, now on their own tab, since the install form should not be the first thing you see.
2. **Installed badge** on cards, from the release list the Helm page already holds, matched by chart name. The chart page lists which releases (name and namespace) it is installed as, and **Upgrade** instead of **Install** when the name and namespace match a release.
3. **Preview before applying.** **Preview** calls the existing dry-run (client-side render only). If the release exists, the preview is a side-by-side diff of its running manifest against the render; if not, the rendered manifest. Secret values masked.
4. **Engine:** `GET /api/helm/chart` (detail), chart archives checked with the same guard as repo URLs and fetched through the guarded transport, Secret values masked in install, upgrade and preview responses. Keywords and deprecation added to the chart list so search can use them.
5. **Search and filter:** search matches name, description and keywords; **Installed only** and **Hide deprecated** filters.

Deferred, with the reason:

| Deferred | Why |
|---|---|
| Artifact Hub search | A third-party call from the engine; breaks air-gapped; ratings are not security signals. Revisit as opt-in. |
| ~~Add repository form~~ | Built (2026-11-19): audited, with a trust note in the form; credentials are stored in the user's repo file as `helm repo add` does and never returned. Remove repository added too. |
| ~~README as rendered Markdown~~ | Built (2026-11-19) with an in-repo renderer that creates React elements (no HTML string, no new dependency); raw HTML dropped, images as alt text, links http/https/mailto only. Tables not rendered. |
| Icons | Loading arbitrary image hosts; breaks air-gapped. Cards use a letter avatar (2026-11-19). A real icon would need an engine proxy through the guarded transport with a size and type limit. |
| Provenance (`.prov`) badge | Needs keyring handling; not a first-slice need. |
| OCI registries, charts in repos not in the Helm config | Different fetch path to guard. |
| Values diff between versions, "what changed in this upgrade" | Needs the chart's values for two versions. The rendered diff covers the on-call need. |
| Installed match by repo, not just chart name | Release records keep the chart name, not the repo. Two repos with the same chart name both show Installed. |
| Categories, ratings, curated featured charts | Content curation, not engine work. |

## 3. What was built

- Engine: `GET /api/helm/chart?repo&name&version`; `locateChart` (guarded index-named archive fetch, used by chart detail, chart values and install/upgrade); keywords and deprecation in `GET /api/helm/charts`; masked manifests in install, upgrade and preview responses. Tests: `helm_chart_test.go`, `helm_preview_test.go`.
- Shell: the chart drawer with Install, README and About tabs, versions picker, Installed badge and filters, Preview with diff. Tests in `components/__tests__/HelmCharts.*.test.tsx` and `lib/__tests__/helmStore.test.ts`.
- Docs: the Helm page of the manual, the Helm help entry, CHANGELOG, BACKLOG #11 (left open).
