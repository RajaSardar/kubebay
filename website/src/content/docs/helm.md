---
title: Helm
description: Every Helm release on the cluster, live, with what it created and how each object is doing, its history, values and manifest. Upgrade with edited values, roll back, uninstall, and install charts from your repos.
section: Integrations
order: 2
appRoutes: ["/helm"]
---

**Helm** in the sidebar's Tools has two tabs: **Releases** and **Charts — install**. Kubebay reads the same release records the `helm` CLI does, as the identity you signed in with.

## Releases

Each release shows its name, namespace, chart, status, revision and when it was last updated. Filter by name, chart or status, and narrow by namespace with the namespace filter.

Releases load in the background from the moment you connect to a cluster, so the list is usually there when you open Helm. It stays live: an install, upgrade, rollback or uninstall made anywhere, from Kubebay or a terminal, shows up as it happens, with no refresh. A release a change is still in progress on shows its pending status. While a release's chart details are still loading, its chart column shows a placeholder.

A pod, or the workload that made it, installed by a release links here from its **Owned by** row (**Helm release <name>**), which opens that release's drawer.

Click a release to open it. It opens on **Overview**. The drawer follows the release as it changes: its status, revision and **Rollback** buttons update while it's open, and if it's uninstalled elsewhere the drawer says so.

### Overview

What the release is and what it made:

- **Release**: the chart and its version, the app version, the revision, the status, when it was last updated, its last change (such as "Upgrade complete") and how it was applied (server-side or client-side apply). **Objects** counts the objects it created by how they're doing, worst first, such as "1 missing · 1 not ready · 4 ok".
- **Everything it created**, grouped as **Workloads**, **Networking**, **Config**, **Storage**, **Scaling**, **Access** and **Other**. Each object's name links to its own page. A kind the cluster no longer serves is marked **not served by this cluster** instead of linked.
- Each object's **Status**, live:
  - **ready**, **progressing** or **not ready** for Deployments, StatefulSets, DaemonSets, Jobs, Pods and PersistentVolumeClaims, with why, such as "1 of 2 available: keeps crashing on start" or "waiting for a volume". Hover a status to read all of it;
  - **present** or **missing** for every other kind;
  - **can't check** where your identity can't list that kind in that namespace. Hover it for the API server's reason. Kubebay never calls something it can't see "missing".
- **Hooks**: each hook, what it runs on (such as `pre-install, pre-upgrade`), how its last run went and when, and what happens to it after it runs.
- **Notes**: the chart's notes, as `helm install` printed them.

A release that has been pending (installing, upgrading or rolling back) for longer than Helm's 5-minute timeout says so at the top: the change may have stopped part-way, and Helm won't start another until it settles.

### History

Every revision, newest first, with its status, chart version, how it was applied, when, and its description. **Rollback** on an earlier revision rolls the release back to it. Click it twice: the second click confirms.

### Values

The release's values, in an editor. Change them, then **Save & upgrade** runs a `helm upgrade` with your values. Leave the chart ref as it is to stay on the same chart, or set it to `repo/name` or a `.tgz` URL. Set a version, or leave it empty for the latest. **Discard** throws your edits away. Your edits, chart ref and version stay with that release: open another release and it starts from its own. Like the `helm` CLI, an upgrade keeps the release's last 10 revisions.

### Manifest

The rendered manifest: every object the release installed, as YAML. The values of a Secret's `data` and `stringData` show as `<redacted>`; their keys stay.

### Uninstall

**Uninstall** removes the release and its objects, after you confirm.

### If you can see only some namespaces

If your identity can't read Helm's release records across the cluster, the page says **You can't list Helm releases here.** with the reason, and asks you to pick the namespaces you use in the namespace filter. It then lists those namespaces' releases. A namespace you picked but can't read is named in a banner above the list, with the reason, and the others are still shown.

## Charts — install

The charts in the Helm repositories you already added. Kubebay reads your local Helm config, so the repos you added with `helm repo add` are already there, and you can add more with **Add repository**. If you have none, it says so.

Each chart is a card with its latest version, description and app version. A chart that a release on this cluster runs shows an **Installed** badge, and a deprecated chart shows **Deprecated**. **Installed** goes by the chart's name: a Helm release records its chart's name and version but not the repo it came from, so when two repos have a chart of the same name, both show **Installed**. The chart's **About** tab narrows it down by version.

- Pick **All repos** or one, and **Search charts…** by name, description or keyword.
- **Installed only** keeps the charts a release on this cluster runs. **Hide deprecated** drops the charts their maintainers deprecated.
- **Update indexes** fetches each repo's latest index, like `helm repo update`.
- With one repo picked, **Refresh** fetches that repo's index only, like `helm repo update <name>`, and beside it the toolbar says when its index was last fetched, such as "Index updated 5m ago" (hover for the exact time), or "Index never fetched". A refresh that fails says why, and the index you had stays in place: a new index replaces the cached one only once Helm has read and validated it.
- Kubebay won't fetch a repo whose URL points at a cloud metadata or link-local address, isn't `http` or `https`, or carries a user name and password; **Update indexes** and **Refresh** report that repo as not fetched. The same check applies to the address a repo's index gives for a chart's archive.

### A chart's page

Click a chart to open it. The release name, namespace and version, with **Preview** and **Install**, stay at the top; the tabs below are:

- **About**: the description, the app version, the releases that already run the chart, its maintainers, home page and source links, and keywords. Links open only when they are `http` or `https` addresses. A release whose chart version this repo's index doesn't list is marked "version not in *repo*'s index": it came from another repo with a chart of the same name, or the version was dropped from this one.
- **README**: the chart's README as formatted text: headings, paragraphs, lists, code, quotes, bold and italic, and tables (GitHub's pipe tables, with their column alignment; long cells wrap). Raw HTML in it is dropped, never run. An image is shown as its alt text and is not loaded, so the README's host learns nothing about you. A link opens in a new tab only for `http`, `https` and `mailto` addresses; any other link is plain text.
- **Values**: the chart's default `values.yaml` in an editor. Edit it to set your own values.
- **Compare versions**: a side-by-side diff of two versions' default `values.yaml`. Pick them in **From version** and **To version**; it starts on the version a release runs (marked "installed") against the newest, or on the two newest. It shows the chart's defaults, not your edits on **Values**. A chart with one version says there is nothing to compare. Each version's archive is fetched through the same checks as an install.
- **Preview** (or **Changes**): appears after you click **Preview**.

The version box lists every version in the repo's index, so you can pick an older one; the default values and About update to it.

### Preview, then install or upgrade

**Preview** renders the chart with your values and shows the result without touching the cluster, as `helm install --dry-run=client` would. For a release name that doesn't exist yet it shows the manifest the install would create. If the name and namespace match a release, the button reads **Upgrade** instead of **Install**, and Preview becomes **Changes**: a side-by-side diff of the running release's manifest against what the upgrade would apply. The values of a Secret show as `<redacted>` in both. Changing the form clears the preview.

When a chart is already installed, opening it starts the form from that release, so an upgrade is one click and a preview. If the name you give is a release of a different chart, a banner says applying will replace it. **Install** and **Upgrade** are recorded in the [Audit Log](/docs/audit-log/).

### Adding and removing repositories

**Add repository** opens a form with **Repository name**, **Repository URL** and an optional **Username** and **Password** for a repository behind basic auth. **Add** has the engine download the repository's index to check it, then saves it in your Helm config (the same `repositories.yaml` `helm repo add` writes, with the password in it if you gave one). Nothing is saved if the check fails, and the reason is shown in the form: a URL that is not `http` or `https`, one that points at a cloud metadata or link-local address, a wrong password, an unreachable host. The password is never shown again. A name may hold letters, digits, dots, dashes and underscores. Only add repositories you trust: their charts are rendered and applied as you.

**Remove repository** (click again to confirm) removes the selected repository from your Helm config and deletes its cached index. Releases already installed from it are not touched. Both actions are recorded in the [Audit Log](/docs/audit-log/).

### Icons

Cards show a letter tile made from the chart's name, not the chart's icon. A chart's `icon` is a URL on another host, and loading it would make your browser contact that host for every card, which Kubebay's content security policy forbids and an air-gapped setup could not do.

## Who Helm acts as

Helm uses the same connection as the rest of Kubebay. On your machine that's your kubeconfig's identity. In a cluster with OIDC sign-in, Helm acts as the person signed in, so the cluster's RBAC decides what they can install, upgrade or remove. Installs, upgrades, rollbacks and uninstalls are all recorded in the [Audit Log](/docs/audit-log/).

## Changes to objects a release installed

If you edit an object that a Helm release installed, such as in the [YAML editor](/docs/resource-details/#yaml), Kubebay warns you. The edit applies, but the release's next upgrade or rollback restores the chart's values. To make a change stick, change the release's values instead.
