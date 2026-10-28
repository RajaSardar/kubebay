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

The release's values, in an editor. Change them, then **Save & upgrade** runs a `helm upgrade` with your values. Leave the chart ref as it is to stay on the same chart, or set it to `repo/name` or a `.tgz` URL. Set a version, or leave it empty for the latest. **Discard** throws your edits away.

### Manifest

The rendered manifest: every object the release installed, as YAML. The values of a Secret's `data` and `stringData` show as `<redacted>`; their keys stay.

### Uninstall

**Uninstall** removes the release and its objects, after you confirm.

### If you can see only some namespaces

If your identity can't read Helm's release records across the cluster, the page says **You can't list Helm releases here.** with the reason, and asks you to pick the namespaces you use in the namespace filter. It then lists those namespaces' releases. A namespace you picked but can't read is named in a banner above the list, with the reason, and the others are still shown.

## Charts — install

A store of the charts in your Helm repositories. Kubebay reads your local Helm config, so the repos you added with `helm repo add` are already there. If you have none, it says so.

- Pick **All repos** or one, and **Search charts…** by name.
- **Update indexes** fetches each repo's latest index, like `helm repo update`.
- Click a chart, set the release name, namespace and version (the latest by default), then **Install**.

## Changes to objects a release installed

If you edit an object that a Helm release installed, such as in the [YAML editor](/docs/resource-details/#yaml), Kubebay warns you. The edit applies, but the release's next upgrade or rollback restores the chart's values. To make a change stick, change the release's values instead.
