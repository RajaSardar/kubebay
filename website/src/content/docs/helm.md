---
title: Helm
description: Every Helm release on the cluster with its history, values and manifest. Upgrade with edited values, roll back, uninstall, and install charts from your repos.
section: Integrations
order: 2
appRoutes: ["/helm"]
---

**Helm** in the sidebar's Tools has two tabs: **Releases** and **Charts — install**. Kubebay reads the same release records the `helm` CLI does.

Kubebay starts watching a cluster's releases as soon as it connects, so the list is ready when you open the page. It stays live: an install, upgrade, rollback or uninstall made anywhere, from Kubebay, a terminal or CI, shows up as it happens.

## Releases

Each release shows its name, namespace, chart, status, revision and when it was last updated. Filter by name, chart or status, and narrow by namespace with the namespace filter.

Click a release to open it. The drawer follows the release live: after an upgrade or rollback made elsewhere, its history and **Rollback** buttons move on with it, and if the release is uninstalled the drawer says so.

### If you can see only some namespaces

If your identity can't read Helm's release records across the whole cluster, pick the namespaces you use in the namespace filter. Kubebay lists their releases, and names any it can't read, with the API server's reason. See [Connect your clusters](/docs/connect-clusters/#when-you-cant-list-namespaces).

### History

Every revision, newest first, with its status, chart version, how it was applied, when, and its description. **Rollback** on an earlier revision rolls the release back to it. Click it twice: the second click confirms.

### Values

The release's values, in an editor. Change them, then **Save & upgrade** runs a `helm upgrade` with your values. Leave the chart ref as it is to stay on the same chart, or set it to `repo/name` or a `.tgz` URL. Set a version, or leave it empty for the latest. **Discard** throws your edits away. Like the `helm` CLI, an upgrade keeps the release's last 10 revisions.

### Manifest

The rendered manifest: every object the release installed, as YAML. A Secret's `data` and `stringData` values are masked; their keys stay.

### Uninstall

**Uninstall** removes the release and its objects, after you confirm.

## Charts — install

A store of the charts in your Helm repositories. Kubebay reads your local Helm config, so the repos you added with `helm repo add` are already there. If you have none, it says so.

- Pick **All repos** or one, and **Search charts…** by name.
- **Update indexes** fetches each repo's latest index, like `helm repo update`.
- Click a chart, set the release name, namespace and version (the latest by default), then **Install**.

## Who Helm acts as

Helm uses the same connection as the rest of Kubebay. On your machine that's your kubeconfig's identity. In a cluster with OIDC sign-in, Helm acts as the person signed in, so the cluster's RBAC decides what they can install, upgrade or remove. Installs, upgrades, rollbacks and uninstalls are all recorded in the [Audit Log](/docs/audit-log/).

## Changes to objects a release installed

If you edit an object that a Helm release installed, such as in the [YAML editor](/docs/resource-details/#yaml), Kubebay warns you. The edit applies, but the release's next upgrade or rollback restores the chart's values. To make a change stick, change the release's values instead.
