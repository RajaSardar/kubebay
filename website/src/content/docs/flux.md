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

## Reconcile, Suspend and Resume

Each card, and the drawer of a Flux object (Custom Resources, or the **Managed by** link), has these buttons. Each opens a confirmation that says what it does, and none shows the "Git will revert this" warning, because they are GitOps actions.

- **Reconcile** asks Flux to reconcile now, by setting the `reconcile.fluxcd.io/requestedAt` annotation to the current time, the same thing `flux reconcile` does.
- **Suspend** sets `spec.suspend: true`. Flux then stops reconciling the object: changes in Git are not applied and drift is not corrected until you resume it. A suspended object shows a **Suspended** pill.
- **Resume** sets `spec.suspend: false`. Flux reconciles again and applies whatever is in Git then. A suspended object offers only **Resume**, because Flux ignores a reconcile request on it.

They are offered only where the kind supports them: Reconcile for Kustomizations, HelmReleases, GitRepositories, HelmRepositories, HelmCharts, OCIRepositories, Buckets, ImageRepositories, ImageUpdateAutomations and ImagePolicies, and Suspend and Resume for all of those except ImagePolicies. The Flux page itself lists Kustomizations and HelmReleases; the other kinds have the buttons in their drawer.

On a cluster whose name looks like production, the confirmation names the cluster and its button reads, for example, **Suspend on prod-eu**. The name is only a guess, so check the cluster. Each action is sent with your own permissions, so Kubernetes refuses it if you may not patch the object, and it is recorded in the audit log with your name and the object's resource.

A resource table's **Managed by** column names the Kustomization or HelmRelease that deploys each object, and links here with it marked. Kubebay warns before you edit or delete an object Flux manages, because Flux will likely put it back on its next reconcile.
