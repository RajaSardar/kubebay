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

## From a resource

A resource table's **Managed by** column names the Application that deploys each object. Click it to come here with that Application marked. Kubebay also warns before you edit or delete an object an Application manages, because Argo CD will likely put it back on its next sync.
