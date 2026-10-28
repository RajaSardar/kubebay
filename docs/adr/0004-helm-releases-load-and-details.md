# ADR 0004: How Helm releases load, and what a release shows

- **Status:** Accepted (2026-10-28). Backlog #9 and #10 asked for research, expert agents and a debate. Four advocates argued (a competitive researcher, an engine performance engineer, a minimal "lazy" engineer, an on-call SRE and security skeptic), and a judge checked their claims against the code and Helm 4.3.1's source before ruling.
- **Date:** 2026-10-28
- **Implemented by:** the fixes and the filtered list (S1–S4) first, then loading (S5–S6), then details (S7–S9).

## Context

Raja's backlog:
- **#10:** "Helm release should load in background when we open/connect a cluster as most of the time listing helm release takes too much time."
- **#9:** "When I click a release it should list all its details including all the created components", after checking how Freelens does it.

Measured on a local envtest API server with 60 releases × 10 revisions (about 70 KB per release Secret): `GET /api/helm/releases` took 2.3–3.1 s and returned 71 KB. The page asks again every 12 s.

Why, from the code:
- Helm's secrets driver lists every `owner=helm` Secret with its data and fully decodes each one (base64, gzip, JSON of the whole release: chart templates, values, manifest), every revision of every release, before keeping the newest (`pkg/storage/driver/secrets.go:90-120`, `pkg/action/list.go:192`). `StateMask` filters only after decoding, so it saves nothing.
- The engine built a new client per request and sent every release's rendered manifest in the list, so rendered `kind: Secret` data reached the browser on every poll. Nothing on the page read it.

The debate also confirmed bugs underneath:
- Helm calls ignore the signed-in identity: `actionCfg` builds its client from the kubeconfig (`HelmEnv`), never from `RestConfigWithIdentity`. In in-cluster mode it most likely fails outright (the "in-cluster" entry has no kubeconfig).
- The release drawer keeps the row as it was when clicked: its status and "Rollback" offer never refresh.
- History comes back in API order (v1, v10, v2…).
- Rollback and uninstall are not audited; install and upgrade are.
- Kubebay's upgrades keep unlimited history (the Helm CLI keeps 10).

How others do it: Freelens runs `helm ls` and re-runs it whenever any Secret changes, and its release drawer lists the manifest's objects grouped by kind, with no live status or hooks. Headlamp and k9s list with `action.List` and show no resources. Rancher watches the release Secrets without decoding, keeps a light summary per release and shows its resources as {apiVersion, kind, name, namespace}.

## Decision

1. **No custom release index in the engine.** A watch-fed index would need a third informer type (the pool has dynamic and metadata only), decoding inside an informer transform (client-go calls transforms "extremely performance sensitive") and a re-implementation of Helm's storage format. Revisit only if the filtered list's p95 exceeds 1 s at 200 releases, and then decode through Helm's own driver.
2. **List only live revisions, with Helm's own code.** The list path wraps the `SecretInterface` given to `driver.NewSecrets` so its LIST asks for `owner=helm,status!=superseded`. Helm rewrites the status label in the same update as the payload, and never labels the newest revision superseded, so the newest revision of every release is in the set; failed revisions stay too, and Helm's keep-newest still runs. Upgrades from Kubebay keep 10 revisions, like the CLI.
3. **Load on connect and stay live, without the 12 s poll.** The shell pre-warms a metadata stream of release Secrets (`v1/secrets`, `owner=helm,status!=superseded`) in the per-identity pool. Rows render from its labels (name, namespace, revision, status) before anything is decoded; chart and app version fill in from the filtered list, fetched again when the stream changes.
4. **Helm runs as the signed-in identity** through a RESTClientGetter built from `RestConfigWithIdentity`, in desktop and in-cluster mode alike. Rollback and uninstall are audited.
5. **Nothing secret in bulk.** Lists and history carry no manifests. The Manifest tab masks Secret `data` and `stringData` values (keys stay). The details endpoint returns object references, never their contents; NOTES pass through `redact.String`.
6. **A release's details** come from one Helm `Get` as the user: the release's facts, its notes, its resources (`{apiVersion, kind, namespace, name}`, kinds the API no longer serves marked so), and its hooks with their last run. An Overview tab, first, shows them grouped by kind, each linked to its page.
7. **Live status of created components is a join in the web** against streams the Overview opens in the manifest's namespaces (cluster-wide for a cluster-scoped kind). Each object is ready, progressing, not ready (with why), present, missing, checking or can't check. A forbidden stream or denied namespace is "can't check", never "missing". Engine GETs per object were rejected: Helm's status code can't tell a 403 from a missing object, and staying live would need polling.
   - *Amended in S9:* the ruling first said to join against the pre-warmed cluster-wide streams. The shell sends each subscription its own snapshot, so sharing one would send every Deployment, or every pod, in the cluster to the drawer. The engine's informers are per namespace and shared across subscriptions, so a namespace-scoped stream costs one LIST and WATCH in that namespace, nothing if a page already watches it. Pods are streamed only once a workload isn't ready, to say why.
8. **Namespace-limited identities (ADR 0003):** the list takes named namespaces, lists each, and names the ones refused.

## The slices

1. **S1** No manifests in list or history; the Manifest tab masks Secret values.
2. **S2** Helm runs as the signed-in identity; rollback and uninstall are audited.
3. **S3** The drawer follows the live release; history newest first.
4. **S4** The list fetches only live revisions; upgrades keep 10.
5. **S5** Releases load on connect and stay live; no 12 s poll.
6. **S6** Named namespaces for namespace-limited identities.
7. **S7** `GET /api/helm/release`: facts, notes, resources, hooks.
8. **S8** The Overview tab, first.
9. **S9** Live status of the created components.

## Deferred

- The custom index, a partial decoder and a decode cache (see 1).
- "Leftover" objects (labelled with the release, no longer in its manifest): with only some kinds streamed, "no leftovers" would be falsely reassuring.
- Expanding a workload row to its ReplicaSets and pods.
- Diffs between revisions; an audited reveal of values; the chart README.
- Releases kept with Helm's ConfigMap or SQL drivers (not supported today either).

## Rejected

- Engine GETs of each object for status (see 7).
- Impersonation through `WrapConfigFn`: it can't fix in-cluster mode, which has no kubeconfig.
- A typed or protobuf informer in the pool; keeping the 12 s poll; `StateMask` filtering.
- Disabling upgrade until values are revealed: the Values tab exists to edit them.
