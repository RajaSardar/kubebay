# ADR 0003: How a namespace-limited identity uses Kubebay

- **Status:** Accepted (2026-10-22). Raja asked for a design debate and a ruling. Four advocates argued (a configured namespace list, automatic discovery in the engine, a minimal web-led picker, a cost-and-honesty skeptic), and a judge checked their claims against the code before ruling.
- **Date:** 2026-10-22
- **Implemented by:** PR A (#181, with this ADR); PR B (#183); PR C (the selection is kept).

## Context

Since #156 and #178, a stream RBAC forbids is ended by the engine with `forbidden: <reason>`, and every page says "You can't list X here." That is honest, but someone whose RBAC allows only some namespaces (a Rancher project member, a developer on an enterprise EKS, GKE or OpenShift cluster, any non-admin in in-cluster mode) still can't see their own namespace anywhere. The namespace picker lists namespaces from a cluster-wide stream they can't read.

The debate found two bugs underneath that affect everyone, admins included:

1. **A subscription over several namespaces lost rows.** The pool sent one snapshot per namespace, the hub wrapped each in begin/items/sync, and the client replaced its rows on every sync. Filtering Deployments to `shop` and `payments` showed only `payments`. Reproduced in the app before the fix.
2. **One refused namespace ended the whole subscription.** The rows already on screen stayed, still marked Live. The assistant tools (MCP) waited 20 s and reported a timeout instead of the refusal.

Facts the ruling rests on:
- No Kubernetes API answers "which namespaces may I list?". SelfSubjectAccessReview and SelfSubjectRulesReview both take a namespace as input, so they can check a name but never find one. SelfSubjectRulesReview also reports `incomplete` under webhook authorizers (EKS access entries, GKE IAM). SelfSubjectReview yields a namespace only for ServiceAccount tokens.
- Engine settings are engine-wide, while in in-cluster mode the pools are per identity (`pool_registry.go`).
- The MCP per-cluster namespace list is an allow-list of what an assistant may read, not a statement of what the user can access.

## Decision

1. **The namespace set is explicit, and the person names it.** The kubeconfig context's `namespace` seeds it, and the picker accepts typed names. It's saved per cluster in the web's persisted cluster store: per kubeconfig context on desktop, per browser (so per person) in in-cluster mode. It is not stored in engine settings, and it is not mixed with MCP's allow-list.
2. **The engine never rescopes a cluster-wide request on its own.** Totals, rankings and "outside your namespaces" counts would present partial data as the whole cluster, and cluster-scoped kinds given a namespace would 404 and retry forever.
3. **No discovery.** Once a refused namespace names itself on the stream, the stream is the check.
4. **The stream comes first (PR A).**
   - A subscription over several namespaces reaches the client as one snapshot holding all of them.
   - A namespace RBAC refuses is named in a `denied` frame (`{type:"denied", id, ns, message}`). The other namespaces stay live, and the client drops the refused namespace's rows.
   - Only when every namespace is refused does the stream end with `forbidden: <reason>`, and the client then stops calling its rows live.
   - MCP takes the one snapshot and returns a refusal at once.
5. **Honesty in the UI.** A list filtered to namespaces with one refused says "You can't list deployments in payments. Showing shop." (`InlineBanner tone="warn"`, with the API server's reason). In fallback mode the picker never says "All namespaces".

## The PRs

- **PR A (#181):** one snapshot per subscription; the `denied` frame; MCP's prompt refusal; `useResourceStream` exposes `denied` and drops the refused namespace's rows; the lists show the warning.
- **PR B, before launch:** `Cluster.Namespace` from the kubeconfig context. When namespaces can't be listed, the picker selects the context namespace, has no "All namespaces" row, says "You can't list namespaces on this cluster. Showing the ones you named.", and takes a typed namespace (DNS-1123 validated), saved per cluster. Topology uses the named list instead of falling back to `default`. The Overview's ForbiddenState offers "Open Pods in <namespace>". Admins see no change.
  - As built: the shell selects the named namespaces (`useNamespaceFallback`) only when the selection is empty, so a pick the person made stands. The last selected namespace can't be unticked, since an empty selection means "all". Typed namespaces can be forgotten; the context's can't. The Overview opens its namespaces stream only once one of its own streams is refused, which needed `useResourceStream` to subscribe when `enabled` turns true (before, a stream that started disabled never subscribed, which also left the Overview's SPOF Radar and Service Health tabs without their PodDisruptionBudgets, Services and EndpointSlices).
- **PR C:** persist the namespace selection, which `NetworkPolicy.tsx` already claims happens.
  - As built: the selection per cluster is kept in browser storage (`kb.namespaces`); "All namespaces" stores nothing, and a stored entry that isn't a list of names is dropped. A kept selection can name a namespace deleted since. It is not pruned automatically: on a cluster switch the shell's namespaces stream still holds the previous cluster's rows for a render, so a prune could drop a valid pick, and it would change the person's selection unasked. Instead, once the namespaces have synced, the picker shows such a namespace ticked and marked "not on this cluster", so it can be unticked.

## Deferred

- A per-namespace Overview: every total, the verdict and the ranking need scope labels first.
- The history sampler and the 7-day chip: recording part of a cluster would make "No trouble in N hours" falsely true.
- Scoping MCP to the named set.
- Sharing pool entries between prewarm's cluster-wide streams and per-namespace ones, and not re-listing after a 403 on every remount.
- Rancher-project discovery.

## Rejected

- An engine-side namespace store.
- Silently rescoping a cluster-wide request.
- Discovery through SelfSubjectRulesReview, SelfSubjectAccessReview or SelfSubjectReview.
