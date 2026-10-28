---
title: Helm
description: Every Helm release on the cluster with its history, values and manifest. Upgrade with edited values, roll back, uninstall, and install charts from your repos.
section: Integrations
order: 2
appRoutes: ["/helm"]
---

**Helm** in the sidebar's Tools has two tabs: **Releases** and **Charts — install**. Kubebay reads the same release records the `helm` CLI does, so a release you install from a terminal shows up within seconds.

## Releases

Each release shows its name, namespace, chart, status, revision and when it was last updated. Filter by name, chart or status, and narrow by namespace with the namespace filter.

Click a release to open it.

### History

Every revision, with its status, chart version, how it was applied, when, and its description. **Rollback** on an earlier revision rolls the release back to it. Click it twice: the second click confirms.

### Values

The release's values, in an editor. Change them, then **Save & upgrade** runs a `helm upgrade` with your values. Leave the chart ref as it is to stay on the same chart, or set it to `repo/name` or a `.tgz` URL. Set a version, or leave it empty for the latest. **Discard** throws your edits away.

### Manifest

The rendered manifest: every object the release installed, as YAML.

### Uninstall

**Uninstall** removes the release and its objects, after you confirm.

## Charts — install

A store of the charts in your Helm repositories. Kubebay reads your local Helm config, so the repos you added with `helm repo add` are already there. If you have none, it says so.

- Pick **All repos** or one, and **Search charts…** by name.
- **Update indexes** fetches each repo's latest index, like `helm repo update`.
- Click a chart, set the release name, namespace and version (the latest by default), then **Install**.

## Changes to objects a release installed

If you edit an object that a Helm release installed, such as in the [YAML editor](/docs/resource-details/#yaml), Kubebay warns you. The edit applies, but the release's next upgrade or rollback restores the chart's values. To make a change stick, change the release's values instead.
