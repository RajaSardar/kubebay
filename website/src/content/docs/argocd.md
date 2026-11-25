---
title: Argo CD
description: Your Argo CD Applications' sync status, health and drift, per resource, from the Kubernetes API, with no Argo CD login.
section: Integrations
order: 3
appRoutes: ["/argocd"]
---

**ArgoCD** in the sidebar's Tools lists the cluster's Argo CD Applications. Kubebay reads the `Application` objects through the Kubernetes API with your kubeconfig, so it needs no Argo CD account or token. If Argo CD isn't installed, the page says so.

Each Application shows its project, repo, target revision, **Sync status**, **Drift**, **Health** and **Last sync**.

## Drift

**Drift** counts the Application's resources that aren't in sync, such as **3 drifted**, or says **in sync**. Click it to see each resource's kind, namespace, name, sync status and health. It's per object, not a line-by-line diff: that needs Argo CD's own API.

## Hard Sync

**Hard Sync** sets the `argocd.argoproj.io/refresh: hard` annotation on the Application, after you confirm. Argo CD then re-reads the Git source, bypassing its cache, and compares again. With automated sync, a difference it finds is then synced. Otherwise, sync from Argo CD.

On a cluster whose name looks like production, **Hard Sync** asks once more, naming the cluster. It is recorded in the audit log as `argocd-hard-refresh` with your name and the Application's resource.

## Rollback

**Rollback** (in the page's Actions column, and in an Application's drawer) rolls the Application back to an entry of its deployment history, the way Argo CD's own rollback does: it sets the Application's `operation.sync` to that history entry's revision and source, with the Application's own sync options, and Argo CD applies it.

1. Pick a **History entry**. It starts on the one before the latest.
2. Tick **Prune resources the revision does not define** if you want resources that revision does not have deleted. It is off by default.
3. Type the Application's name to confirm, then press **Roll back to** the revision.

Kubebay refuses, and says why, when the Application has **automated sync** enabled: Argo CD would sync it straight back to Git and undo the rollback. **Show sync policy** displays the Application's `syncPolicy`, and you turn automated sync off there or in Git first. It also refuses while another operation is running on the Application, and when it has no history.

A rollback is a change to the cluster that Git does not contain, so Argo CD will show the Application as out of sync afterwards. On a cluster whose name looks like production, the confirm button names the cluster. It uses your own permissions and is recorded in the audit log as `argocd-rollback`, with your name and the Application's resource.

## From a resource

A resource table's **Managed by** column names the Application that deploys each object. Click it to come here with that Application marked. Kubebay also warns before you edit or delete an object an Application manages, because Argo CD will likely put it back on its next sync.
