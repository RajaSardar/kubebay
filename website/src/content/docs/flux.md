---
title: Flux
description: Flux Kustomizations and HelmReleases, whether each is Ready, what it manages, and recent drift Flux has already corrected.
section: Integrations
order: 4
appRoutes: ["/flux"]
---

**Flux** in the sidebar's Tools lists the cluster's Flux `Kustomization` and `HelmRelease` objects. If Flux isn't installed, the page says so.

For each one:

- **Ready**, **Not ready** or **Unknown**, from its Ready condition, with the condition's message;
- how many objects it currently manages, from its inventory;
- how many times Flux recently detected drift, and fixed it, from its events.

Flux's kustomize-controller corrects drift when it reconciles, rather than reporting it. So this isn't a diff view like [Argo CD's](/docs/argocd/). It's the Ready condition, what each object manages, and the drift Flux has already put right.

A resource table's **Managed by** column names the Kustomization or HelmRelease that deploys each object, and links here with it marked. Kubebay warns before you edit or delete an object Flux manages, because Flux will likely put it back on its next reconcile.
