# CNCF Landscape Submission Guide for Kubebay

The CNCF Landscape lives at https://landscape.cncf.io and accepts new entries via pull requests
to https://github.com/cncf/landscape. This document is a complete, copy-paste-ready guide for
submitting Kubebay.

---

## 1. Landscape Card Description (max 120 characters)

The landscape card description must be **120 characters or fewer**. Use this:

```
Local-first Kubernetes IDE. Live-streaming views, RBAC explorer, Helm manager. No accounts, no telemetry.
```

Character count: 104. Fits within the limit.

If a shorter variant is ever needed (some tooling enforces ~80 chars for thumbnails):

```
Local-first Kubernetes IDE — live views, RBAC explorer, Helm manager. MIT, no accounts.
```

---

## 2. YAML Block to Add to `landscape.yml`

Find the section for **category: Kubernetes** → **subcategory: Kubernetes Tools** in
`landscape.yml`. Add the Kubebay entry in alphabetical order by `name` (between "K" entries,
after "Kube" projects that sort before "Kubebay").

```yaml
      - item:
          name: Kubebay
          homepage_url: https://github.com/RajaSardar/kubebay
          repo_url: https://github.com/RajaSardar/kubebay
          logo: kubebay.svg
          license: MIT
          description: >-
            Local-first Kubernetes IDE. Live-streaming views, RBAC explorer,
            Helm manager. No accounts, no telemetry.
          twitter: ''
          crunchbase: ''
```

**Field notes:**

- `homepage_url` — point to the GitHub repo until a dedicated website exists; update to
  `https://kubebay.dev` (or similar) once live.
- `repo_url` — must be a public GitHub/GitLab/etc. repo; used to pull star count and activity.
- `logo` — filename only; the actual SVG file goes into `hosted_logos/` in the landscape repo
  (see section 3 below).
- `license` — must match the SPDX identifier exactly; Kubebay is `MIT`.
- `crunchbase` — leave empty string if no Crunchbase org exists; the field is required in the
  schema but can be blank for community projects.
- `twitter` — leave empty string if not set up yet.

---

## 3. Logo Requirements

The CNCF Landscape has strict logo rules. Meet all of them before filing the PR.

| Requirement | Detail |
|---|---|
| Format | SVG only (no PNG, no WebP) |
| Max file size | 1 MB (keep it under 200 KB in practice) |
| Background | Transparent; do not embed a white/colored background rectangle |
| Text in logo | Avoid rasterized text; convert to paths so it renders at any size |
| Color | Works on both white and dark backgrounds (use the light/dark variant if needed) |
| Filename | Lowercase, hyphen-separated: `kubebay.svg` |
| Destination in PR | `hosted_logos/kubebay.svg` inside the `cncf/landscape` repo |
| Minimum detail | The logo should be recognizable at 50×50 px (thumbnail size on the landscape grid) |

**How to create a compliant SVG:**

1. Export from Figma/Illustrator/Inkscape with "Export as SVG" (not "SVG for web" which may embed
   raster data).
2. Run through SVGO to strip metadata and reduce file size:
   ```bash
   npx svgo --multipass hosted_logos/kubebay.svg
   ```
3. Open the resulting file and confirm there is no `<image>` tag (that would be a raster embed).
4. Test render at 32px, 64px, and 256px to confirm legibility.

---

## 4. Step-by-Step PR Instructions

### Prerequisites

- A GitHub account with git configured locally.
- `gh` CLI installed (`brew install gh`) or use the GitHub web UI.

### Steps

**Step 1 — Fork and clone the landscape repo**

```bash
gh repo fork cncf/landscape --clone
cd landscape
```

**Step 2 — Create a branch**

```bash
git checkout -b add-kubebay
```

**Step 3 — Add the logo**

Copy your compliant SVG into the repo:

```bash
cp /path/to/kubebay.svg hosted_logos/kubebay.svg
```

Verify size:

```bash
ls -lh hosted_logos/kubebay.svg   # must be < 1 MB
```

**Step 4 — Edit `landscape.yml`**

Open `landscape.yml` and locate:

```yaml
  - category:
      name: Kubernetes
      subcategories:
        - subcategory:
            name: Kubernetes Tools
            items:
```

Insert the Kubebay YAML block from section 2 above in alphabetical order within the `items` list.

**Step 5 — Validate locally (optional but recommended)**

The landscape repo has a validation script. Run it to catch YAML errors before pushing:

```bash
# Node.js must be installed
npm install
npm run check-entries
```

If the above commands don't exist in the current version of the repo, check `package.json` for
the correct script name.

**Step 6 — Commit and push**

```bash
git add hosted_logos/kubebay.svg landscape.yml
git commit -m "Add Kubebay to Kubernetes Tools"
git push origin add-kubebay
```

**Step 7 — Open the PR**

```bash
gh pr create \
  --repo cncf/landscape \
  --title "Add Kubebay to Kubernetes Tools" \
  --body "$(cat <<'EOF'
## What is this project?

Kubebay is a free, open-source, local-first Kubernetes IDE built with a Go engine and a Tauri
desktop shell. It provides live-streaming resource views, an RBAC explorer, Helm manager,
port-forward manager, CRD browser, and event timeline — with no accounts, no cloud control
plane, and no mandatory telemetry.

## Why does it belong on the landscape?

- Fills the vacuum left by Lens going closed-source and the Kubernetes Dashboard being archived
  in January 2026.
- MIT licensed, public roadmap, active development.
- Runs on macOS, Linux, and Windows; also available as a headless CLI engine and (upcoming)
  in-cluster Helm chart.
- Repo: https://github.com/RajaSardar/kubebay

## Checklist

- [x] SVG logo added to `hosted_logos/kubebay.svg`
- [x] Entry added to `landscape.yml` under Kubernetes > Kubernetes Tools
- [x] `homepage_url` is publicly accessible
- [x] `repo_url` is a public GitHub repo
- [x] License is MIT (SPDX: MIT)
- [x] Description is ≤ 120 characters
EOF
)"
```

**Step 8 — Respond to reviewer feedback**

CNCF landscape maintainers typically review within 1–4 weeks. Common requests:

- Logo adjustments (transparent background, remove padding, SVG path cleanup).
- Description wording tweaks.
- Correct alphabetical placement in `landscape.yml`.
- Crunchbase organization entry (create a free one at crunchbase.com if asked).

---

## 5. Readiness Checklist

The CNCF Landscape does not publish a hard star-count threshold for tools, but in practice
submissions that sail through review consistently meet these criteria. Check each box before
filing the PR.

### GitHub Repository Health

- [ ] Repository is public on GitHub.
- [ ] README clearly explains what the project does, who it is for, and how to install/use it.
      Kubebay's README already meets this bar.
- [ ] At least one tagged release exists with downloadable artifacts. (Kubebay: v0.1.2+, done.)
- [ ] CI badge is green and visible in the README. (Done — GitHub Actions CI badge present.)
- [ ] `LICENSE` file is present at the root with a recognized OSI license. (Done — MIT.)
- [ ] `CONTRIBUTING.md` exists. (Done.)
- [ ] `CODE_OF_CONDUCT.md` exists. (Done.)
- [ ] Issues and PRs are open and at least some are responded to within a reasonable timeframe.

### Star Count

There is no enforced minimum, but landscape reviewers do informally apply a quality bar. Projects
with fewer than ~25–50 GitHub stars are occasionally asked to wait for more community traction.
Kubebay should aim for at least 50 stars before filing the PR for the smoothest experience. If
stars are below that at submission time, it helps to include a short note in the PR body about
active external users or usage signals (downloads, Homebrew installs, etc.).

### License

`MIT` is fully accepted. The SPDX identifier `MIT` (used in `landscape.yml`) is correct.

### Security Policy

A `SECURITY.md` exists in the repo — this is not required by the landscape but is good hygiene
and may be noted positively by reviewers.

### Crunchbase

The landscape schema includes a `crunchbase` field. For open-source projects without a company
behind them, this can be left as an empty string. If a reviewer requests it, create a free
organization profile at https://www.crunchbase.com and link it.

---

## 6. After Acceptance

Once the PR is merged:

1. The landscape site rebuilds automatically (usually within 24 hours).
2. Verify Kubebay appears at https://landscape.cncf.io under Kubernetes > Kubernetes Tools.
3. Add a landscape badge to the README:

```markdown
[![CNCF Landscape](https://img.shields.io/badge/CNCF%20Landscape-5699C6?logo=cncf&logoColor=white)](https://landscape.cncf.io/?item=provisioning--automation-configuration--kubebay)
```

(Update the `item=` query param to match the exact slug assigned by the landscape after merge —
check the rendered URL by clicking on the Kubebay card on the live site.)

---

## 7. Quick Reference

| Field | Value |
|---|---|
| Category | Kubernetes |
| Subcategory | Kubernetes Tools |
| Name | Kubebay |
| Homepage URL | https://github.com/RajaSardar/kubebay |
| Repo URL | https://github.com/RajaSardar/kubebay |
| Logo file | `hosted_logos/kubebay.svg` |
| License | MIT |
| Description (≤120 chars) | `Local-first Kubernetes IDE. Live-streaming views, RBAC explorer, Helm manager. No accounts, no telemetry.` |
| Target landscape section | https://landscape.cncf.io (Kubernetes > Kubernetes Tools) |
| PR target repo | https://github.com/cncf/landscape |
