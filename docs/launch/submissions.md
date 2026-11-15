# Ready-to-paste submissions

> **On hold.** Nothing here is submitted. Paste each one on its day in the [sequence](README.md#sequence). Fields are written to each site's usual limits; check the live form, since limits change.

Common facts, used everywhere:

| Field | Value |
|---|---|
| Name | Kubebay |
| Website | https://kubebay.sardar.dev |
| Repo | https://github.com/RajaSardar/kubebay |
| Docs | https://kubebay.sardar.dev/docs/ |
| Licence | MIT |
| Platforms | macOS (universal), Windows x64 and Linux x86_64 (Preview), plus a single binary that serves the UI to a browser, and a Helm chart |
| Price | Free. No account, no telemetry. |
| Media | [`media/`](media/): screenshots at 2880×1800, `kubebay-tour.gif` (960 px wide, ~26 s), `kubebay-tour.mp4`, `social-preview.png` (1280×640). Demo cluster, synthetic data. |

---

## One-liners (pick by length)

- **≤ 60 chars:** Free, local-first Kubernetes IDE. No account.
- **≤ 120 chars:** Local-first Kubernetes IDE that flags single points of failure, NetworkPolicy gaps and attack paths. MIT.
- **≤ 260 chars:** Kubebay is a free, MIT-licensed Kubernetes IDE that runs on your machine. Beyond live tables, logs, exec and Helm, it tells you what's fragile: single points of failure, NetworkPolicy gaps, attack paths, and requests far from real usage. No account, no telemetry.

---

## AlternativeTo (week 1)

- **Category:** Development → Kubernetes / DevOps tools
- **Short description:** Free, local-first Kubernetes IDE that flags single points of failure, NetworkPolicy gaps and attack paths.
- **Description:**
  Kubebay is a free, open-source (MIT) Kubernetes IDE. A Go engine watches your clusters once and streams every change to the UI, so nothing needs a Refresh button. It runs as a desktop app (Tauri), a single binary that serves the UI to your browser, or a Helm chart in the cluster with OIDC.

  Besides live tables for every kind and CRD, logs, exec, port-forwards and Helm, it analyses the cluster: single points of failure, NetworkPolicy coverage and reachability, attack paths from exposed Services to risky RBAC, requests compared with real usage, APIs a coming Kubernetes release removes, and Argo CD and Flux drift. No account, no telemetry, and your kubeconfig stays on your machine.
- **Alternative to:** Lens, Freelens, Headlamp, k9s, Kubernetes Dashboard, Aptakube, Octant
- **Tags:** kubernetes, k8s, devops, kubernetes-ide, desktop, open-source, self-hosted
- **Screenshots:** `workloads-overview.png`, `workloads-overview-spof-radar.png`, `rbac.png`, `network-policy.png`, `topology.png`

---

## Awesome lists (week 1, one PR each, following each list's format and order)

**[ramitsurana/awesome-kubernetes](https://github.com/ramitsurana/awesome-kubernetes)**, in its desktop/GUI tools section:

```markdown
- [Kubebay](https://github.com/RajaSardar/kubebay) - Local-first Kubernetes IDE (desktop, browser or in-cluster) that flags single points of failure, NetworkPolicy gaps and attack paths. MIT.
```

**An MCP server list** (the MCP server is part of the app, off by default):

```markdown
- [Kubebay](https://github.com/RajaSardar/kubebay) - Kubernetes IDE with a built-in MCP server: read-only by default, changes proposed and approved one by one, every call in a local audit log.
```

**A Tauri showcase list:**

```markdown
- [Kubebay](https://github.com/RajaSardar/kubebay) - Kubernetes IDE: a Go engine as a Tauri sidecar with a React UI.
```

PR title: `Add Kubebay`. PR body: one sentence on what it is, "I'm the author" (most lists require disclosure), and the licence.

---

## Product Hunt (week 2, Tue–Thu, 12:01 am PT)

- **Name:** Kubebay
- **Tagline (≤ 60):** The free Kubernetes IDE that tells you what's fragile
- **Description (≤ 260):** use the 260-character one-liner above
- **Topics:** Developer Tools, Open Source, DevOps, Kubernetes (if offered)
- **Pricing:** Free
- **Gallery, in order:** `social-preview.png` (thumbnail), `kubebay-tour.gif`, `workloads-overview-spof-radar.png`, `rbac.png`, `network-policy.png`, `topology.png`
- **Video:** upload `kubebay-tour.mp4` to YouTube (unlisted is fine) and link it
- **Maker comment:** a shortened version of the Show HN first comment ([show-hn.md](show-hn.md)), ending with a question ("what check would you want next?")
- **Links:** website, repo

---

## Newsletters (day 3, submit the launch article, not the repo)

**KubeWeekly** (CNCF, via the form in [cncf/foundation KubeWeekly.md](https://github.com/cncf/foundation/blob/master/KubeWeekly.md)):

> **Why I built another Kubernetes UI, and what it does that the others don't.** With the Dashboard archived, the author of Kubebay, a free MIT Kubernetes IDE, explains why it reports single points of failure, NetworkPolicy reachability and attack paths instead of just showing the cluster, and how one Go engine streams every view live.

**Learnk8s** ([learnk8s.io/newsletter](https://learnk8s.io/newsletter), "Submit a link"): the article URL plus the same two sentences.

**Console.dev, DevOps Weekly, SRE Weekly, Golang Weekly, TLDR DevOps:** the article URL plus:

> Kubebay is a free, local-first Kubernetes IDE (Go + Tauri, MIT). Beyond tables and logs it finds single points of failure, NetworkPolicy gaps and attack paths, from the API alone, with no account and no telemetry.

---

## Roundup authors (week 2, a personal note each, never a mass mail)

> Subject: A Kubernetes UI for your "Dashboard alternatives" piece?
>
> Hi {name},
>
> I read your {article title}. It's one of the clearer comparisons after the Dashboard was archived. I'm the author of Kubebay, a free, MIT-licensed Kubernetes IDE that runs on your machine (desktop, browser or in-cluster).
>
> What might make it worth a look for your readers: besides the usual tables, logs and exec, it reports what's fragile, meaning single points of failure, NetworkPolicy reachability and attack paths from exposed Services to risky RBAC. A 25-second GIF: {link to kubebay-tour.gif}.
>
> It's v0.7 and a solo project, so I'm not asking to be added, just considered when you next update it. Happy to answer anything.
>
> Raja
> https://github.com/RajaSardar/kubebay

---

## Package managers (week 2–4)

- **winget:** `wingetcreate new https://github.com/RajaSardar/kubebay/releases/download/v<version>/Kubebay_<version>_x64-setup.exe` generates the manifest and opens the PR to `microsoft/winget-pkgs`. Package identifier: `RajaSardar.Kubebay`.
- **AUR:** a `kubebay-bin` PKGBUILD that installs from the `.deb`, with `sha256sums` from the release.
- **Artifact Hub:** add the chart repository in the Artifact Hub control panel once `charts/kubebay` is published as a Helm repository (check where the release workflow publishes it).
