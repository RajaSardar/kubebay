# A service mesh view without installing anything

> Backlog item 39. Researched 2026-11-18 against `main` at v0.7.6. Read-only research: nothing here is built.
>
> Labels: **read** = from the code or the Kubernetes API model; **not measured** = no benchmark run; **unverified** = a claim about the outside world not re-checked for this note.

## 1. The question

Can Kubebay show a "service mesh" view (who talks to whom, how healthy, how much traffic) on a cluster where the user installs nothing, neither a mesh nor an agent?

## 2. Short answer

**Yes for structure, no for live traffic.** With read-only API access Kubebay can draw an accurate **dependency map**: which workloads sit behind which Services, which Ingress or Gateway routes reach them, which NetworkPolicies allow what, and which workloads *declare* a dependency on a Service. It cannot know **who actually called whom, how often, or how slowly**: that data exists only in a data plane (sidecar, eBPF, or the app's own metrics). Where the cluster *already* has Istio, Linkerd, Cilium/Hubble or Prometheus, Kubebay can read those and overlay real traffic, still installing nothing. Recommendation: build the structural map first, **call it "Service map", not "service mesh"**, label every edge as *declared*, *inferred* or *observed*, then add opt-in read-only overlays for mesh CRDs and Prometheus when auto-detected.

## 3. What exists today (read)

- **Topology page** (`web/apps/shell/src/pages/Topology.tsx`, `lib/topology.ts`): one namespace; Deployments, StatefulSets, DaemonSets, ReplicaSets, pods and Services, with Service to pod edges by selector, live over the pod stream. See `website/src/content/docs/topology.md`.
- **NetworkPolicy tooling** (`lib/netpolEval.ts`, `netpolMatrix.ts`, `networkPolicyCoverage.ts`, `netpolBuilder.ts`): evaluates which pods can reach which.
- **Service selector mismatch** (`lib/serviceSelectorMismatch.ts`), **owner chains** (`useOwnerChain.ts`, `podOwner.ts`), **Prometheus discovery** (`engine/internal/prometheus/discover.go`, `lib/prometheusServiceDiscovery.ts`), and **node metrics** through `metrics.k8s.io` (`engine/internal/httpapi/metrics.go`).

So roughly half of the structural map is already drawn, within one namespace and without Ingress or cross-namespace edges.

## 4. What can be derived with no install

| Source | What it gives | Edge type | Limits |
|---|---|---|---|
| Services, Endpoints, EndpointSlices | Service to backing pods and nodes, ready vs not-ready endpoints, headless services, ExternalName targets | declared + current | Says who *serves*, never who *calls*. EndpointSlices are the scalable source; Endpoints is being phased out in newer Kubernetes (**unverified** for the exact version) |
| Owner references | Pod to ReplicaSet to Deployment, Job to CronJob, so edges can be drawn between *workloads*, not pods | declared | Already in `topology.ts` |
| Ingress, and Gateway API (`Gateway`, `HTTPRoute`, `GRPCRoute`) when the CRDs exist | Edge-in: host/path to Service, TLS, cross-namespace `ReferenceGrant` | declared | Gateway API CRDs exist only if someone installed them; detect, do not assume |
| NetworkPolicy | Allowed ingress/egress peers by selector, namespace and CIDR | declared (allowed, not used) | Enforced only if the CNI supports it; no policy means "everything allowed", a hairball. Show as faded "allowed paths" |
| Pod spec: env, args, `envFrom`, ConfigMaps | Hard-coded dependencies: `*_HOST`, `*_URL`, `*.svc.cluster.local`, `service.namespace:port`, and Kubernetes' injected `<SVC>_SERVICE_HOST` env vars (these name Services that existed when the pod started) | **inferred** (heuristic) | String matching; misses config fetched at runtime, Secrets, and apps that read names from files. Show the matched text as evidence |
| Pod ports, probes | What a workload listens on, its readiness | declared | Container ports are optional metadata |
| ServiceAccounts, RoleBindings | Who may call the API; **not** workload to workload | n/a | Security overlay only |
| CoreDNS config and logs (if readable) | Query names per client IP if the `log` plugin is on | observed | Off by default and unreadable to most users; **do not rely on it** |
| Events, node and pod status | Failing endpoints, restarts, not-ready, to colour nodes | observed (health, not traffic) | |

Combining these gives a **declared dependency graph** whose edges are classified: *routes to* (Ingress/Gateway to Service), *serves* (Service to pods), *allowed* (NetworkPolicy), *inferred* (env/config reference). The inferred layer is the novel value; it must always show its evidence and never claim certainty.

## 5. Already-installed meshes and tools (read-only, nothing installed)

All optional, detected by looking for the CRD or Service, read through the access the user already has. Names below are **unverified**; check each project's docs before building.

- **Istio:** `VirtualService`, `DestinationRule`, `Gateway`, `ServiceEntry`, `AuthorizationPolicy`, `PeerAuthentication` give *routing and policy* edges (traffic splits, mTLS mode, allowed principals). Sidecar presence is visible from pod containers (`istio-proxy`) and annotations. Real traffic needs Istio's metrics (`istio_requests_total`) in Prometheus, which falls under section 6.
- **Linkerd:** `Server`, `AuthorizationPolicy`, `HTTPRoute`, `ServiceProfile` CRDs and the `linkerd-proxy` container. Its `viz` extension exposes a metrics API, usable only if already installed.
- **Cilium / Hubble:** if Hubble Relay is running, flows are queryable over gRPC via a port-forward to the relay Service. This is the only no-extra-install source of *observed* L3/L4/L7 flows, but needs a new gRPC client in the engine. `CiliumNetworkPolicy` and `CiliumEndpoint` CRDs give richer policy and identity edges.
- **Others** (Consul, Kuma, AWS App Mesh, Open Service Mesh): none verified; a plug-in point, not phase 1.

Detection reuses the pattern of `trivyOperator.ts`, `karpenter.ts`, `keda.ts` and `flux.ts` in the shell (detect CRDs, then render), so the engineering shape is known.

## 6. What cannot be done, and the options

**Cannot, without a data plane:** request rate, error rate, latency, bytes, or "service A called B at 14:02". The API server does not see pod-to-pod traffic. Anything claiming this without a sidecar, eBPF probe or app metrics is guessing, and we must not draw numbers from NetworkPolicy or env references.

Options, in order of fit with Kubebay's "no install, read-only, safe" stance:

1. **Prometheus, if already there (best option).** Kubebay already discovers Prometheus (`prometheus/discover.go`) and reaches it through the API server. If it finds Istio (`istio_requests_total`), Linkerd (`request_total`), Cilium/Hubble metrics or ingress-controller metrics such as nginx's (`nginx_ingress_controller_requests`) (**all metric names unverified**), it can run a few fixed, read-only, rate-limited PromQL queries and label edges *observed* with rate, error and latency. Bound it: fixed templates, range and step limits, a timeout, a per-cluster query budget.
2. **Hubble Relay, if present.** Optional, later.
3. **Pod/service proxy sampling.** The API server's `pods/proxy` and `services/proxy` allow a GET to a pod's metrics port. Scraping an app's `/metrics` may reveal client-side counters (for example `http_client_requests_total{target=...}`), but names vary per app and library, name-mapping is a heuristic, the `proxy` RBAC verb is often denied, and it is active traffic against workloads. **Not recommended as a default**; at most an explicit "sample now" action on one workload.
4. **Install an eBPF agent or a mesh.** Out of scope for this question. Name it as the upgrade path in the empty state ("for live traffic, install X or point Kubebay at your Prometheus").
5. **Active probing** (exec curl inside pods): rejected. It needs `pods/exec`, is noisy, and is not read-only in spirit.

## 7. Recommendation

**Build "Service map": a structural dependency graph with an honest edge legend, plus opt-in observed overlays.**

- Edge kinds in the UI: *routes to* (Ingress/Gateway), *serves* (Service to workload), *allowed* (NetworkPolicy, faded), *inferred* (env/config, dashed, with evidence), *observed* (Prometheus/Hubble, with numbers and a time window). A legend and the ⓘ state which are guesses.
- Scope: start per namespace like Topology, then a cross-namespace toggle. Bound large clusters: collapse to workload level, cap node count, reuse the stream cache so no new streams open for kinds already followed. EndpointSlices and Ingresses are the new kinds; follow them on demand, not in prewarm.
- Reuse, not rewrite: extend `lib/topology.ts` with an edge model and put inference in a pure, tested module like `netpolEval.ts`.
- Name it carefully: "Service map", because "mesh" promises traffic data we do not have unless an overlay is detected.
- Read-only throughout: no sidecar injection, no policy changes, no port-forwards unless the user clicks.

## 8. Phased plan

| Phase | Ships | Size |
|---|---|---|
| 1. Declared map | Namespace Service map: workload nodes, Services, Ingress edges, EndpointSlice readiness, edge legend. Extend Topology or add a tab to it. | M |
| 2. Inference and policy | Env/config reference edges with evidence; NetworkPolicy "allowed paths" overlay using `netpolEval`; findings for "Service with no ready endpoints" and "blocked by policy". | M |
| 3. Mesh and gateway CRDs | Detect Gateway API, Istio, Linkerd, Cilium CRDs; draw routing, mTLS and authorisation edges; sidecar badge. Verify CRD names first. | M |
| 4. Observed overlay | Detect Prometheus plus a known mesh or ingress metric; fixed, bounded PromQL templates; rate, error and latency on edges. Hubble as a separate follow-up. | M-L |

Each phase is test-first (pure functions with fixtures), updates its docs page and `help.ts` entry (CLAUDE.md docs rule), and uses only `@kubebay/ui` components.

## 9. Acceptance checks

1. A fixture namespace (Ingress to Service to Deployment to pods, plus a pod with `DB_HOST=postgres.data.svc`) yields exactly the expected edge list with the right kinds, from a pure-function test.
2. Every drawn edge is classified; an *inferred* edge always carries its evidence string; no edge shows traffic numbers unless its source is *observed*.
3. On a cluster with none of the optional CRDs or Prometheus, phases 1 and 2 render with no errors and no repeated failed requests (CRD absence is detected once, not probed repeatedly).
4. No new always-on streams: opening the page starts only the kinds it needs and releases them on leave (checked by the subscription count, as in `docs/GLOBAL_SEARCH.md`).
5. A 2,000-pod namespace stays interactive (collapsed to workloads; frame-time and node-count budget set in phase 1).
6. Observed overlay: query count per refresh is bounded and visible; a denied or missing Prometheus degrades to the structural map with a one-line reason.

## 10. Open questions

- Cross-namespace in v1, or per namespace like Topology? (RBAC: a namespace-limited identity sees only its own, see `namespaceAccess.ts`.)
- Which overlay first: Prometheus-generic (covers Istio, Linkerd, ingress) or Hubble (covers any Cilium cluster, needs a gRPC client)?
- Is "inferred from env" acceptable to ship given false positives? Proposed: yes, dashed and hideable.

## 11. Phase 3 status (2026-11-19)

Built: an All namespaces map (per-namespace groups, 400-node budget) and an opt-in Prometheus observed overlay limited to `istio_requests_total` (source/destination workload and namespace labels) and `nginx_ingress_controller_requests` (ingress, namespace, service labels), via the existing guarded `/api/prom/query`. Not read, because no field or metric names could be verified from a schema in this repo: Linkerd, Cilium CRDs and Hubble. The metric names are upstream conventions and have not been run against a live Istio or ingress-nginx cluster.

## 12. Observed traffic across namespaces (2026-11-23)

Built: the observed overlay now works on **All namespaces**. It runs one cluster-wide PromQL query per metric family (no per-namespace fan-out), `topk(501, sum by (source_workload, source_workload_namespace, destination_workload, destination_workload_namespace) (rate(istio_requests_total{reporter="destination"}[5m])))` and `topk(501, sum by (ingress, namespace, service) (rate(nginx_ingress_controller_requests[5m])))`, keeps the 500 busiest series and says when more existed. Each end of a series is matched to the node in the namespace its labels name, so cross-namespace calls draw observed edges between groups (hidden with **other namespaces**); nodes cut by the 400-node budget draw no traffic. No metric or label names were added beyond those in section 11. Also built: Gateway API **ReferenceGrant** (`spec.from` group/kind/namespace, `spec.to` group/kind/optional name) is read cluster-wide when the CRD exists, and a cross-namespace HTTPRoute or GRPCRoute `backendRef` with no matching grant in the target namespace becomes an "ungranted-reference" finding. Limits: a grant in a namespace the identity cannot list counts as missing; the queries are not run against a live Istio or ingress-nginx Prometheus (**not measured**: query cost on a large mesh).
