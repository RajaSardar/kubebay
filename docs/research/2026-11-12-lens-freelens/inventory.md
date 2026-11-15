# Kubebay feature inventory (IDs are stable; every researcher uses these)

Kubebay = the product in <repo> (docs: website/src/content/docs/*.md, code: engine/ Go, web/apps/shell React).

## Clusters and connection
F01 Cluster list showing session age, API reachability, version, pods, nodes, 7-day CPU sparkline, requests %
F02 Resizable columns, search, pin star, rename/alias, icon + colour + short-name picker on the cluster list
F03 Add kubeconfig files; "kubeconfig sources" with an isolated mode (only listed files, default ~/.kube/config and KUBECONFIG ignored)
F04 Find EKS, GKE and AKS clusters without editing a kubeconfig (cloud cluster discovery)
F05 Several clusters connected at once, switch between them; core kinds stream in the background so tabs open instantly
F06 Clear handling when RBAC forbids listing namespaces or a kind (partial views, not a hard failure)

## Navigation and interface
F07 Sidebar of grouped resource kinds (Workloads, Configuration, Network, Storage, Devices/DRA, Access Control, Admission, Cluster) with hide toggle
F08 Command palette (⌘K) searching pages, kinds, saved views, clusters, active port-forwards and live pods
F09 Keyboard-first tables: "/" focus filter, j/k/Enter/x to move, open, select
F10 Multi-select, searchable namespace filter
F11 Saved views and favourites (including starring a CRD or an API group into the sidebar)
F12 Open a resource drawer as a full page (⌘⇧Enter) or split it to see two tabs side by side (⌘⇧S)
F13 An ⓘ help button on every page and insight card linking to the manual
F14 Copy-name button on resources
F15 12 themes including high-contrast themes with documented WCAG contrast (4.5:1 text, 7:1 in high-contrast), font size/family, table density
F16 Virtualised tables with a column chooser and drag-resizable columns
F17 Extensions: add your own table columns and row actions (e.g. a Grafana link) from one YAML file

## Resource browsing
F18 Live table for every kind incl. Endpoints/EndpointSlices, IngressClasses, ValidatingAdmissionPolicy, DRA devices, CSI objects, FlowSchemas
F19 CRD list plus a table per custom resource kind (auto-discovered)
F20 Row actions: view, edit YAML, show pods, scale, restart, delete (with a warning if Argo CD or Flux manages the object); bulk delete
F21 "Managed by" column naming the Argo CD Application / Flux Kustomization or HelmRelease that deploys each object
F22 Create Resource from templates or YAML with dry-run and admission-policy rejections explained in plain terms
F23 Live "Owned by" chain that links up through every owner (Helm release, Deployment, ReplicaSet, Rollout, CRD owners)

## Resource drawer
F24 Rollout tab: ready replicas per revision, new vs old ReplicaSet
F25 Timeline tab: events, rollout revisions, condition changes and container terminations on one timeline; plus a cluster-wide Timeline page with warnings-only view
F26 Autoscaling tab: every HPA, VPA and KEDA ScaledObject targeting a workload
F27 Policy tab: Kyverno / PolicyReport findings for an object
F28 YAML editor with server-side apply, dry-run diff, and refusal to overwrite a concurrent change
F29 Actions: scale (− / +), restart, CronJob trigger-now and suspend/resume, delete with confirmation

## Pods
F30 Pod Summary: Pod IP(s) incl. dual-stack, Host IP(s), env vars (Secret values masked until clicked, reveal audited), volumes, probes, conditions, QoS, scheduler, node link
F31 Logs: follow, previous, filter, download, multi-container picker, honours the default-container annotation
F32 Terminal exec into a pod with shell fallback (distroless-aware)
F33 Graphs tab: per-container CPU/memory from the cluster's Prometheus with time ranges
F34 Size tab: resize CPU/memory requests and limits of a running pod in place
F35 AI Triage tab: ask a model why a pod is failing; shows exactly what it would send, masks credentials, sends only on request
F36 One-click port-forward chips from a pod's declared ports
F37 Force delete / remove finalizers on a pod

## Nodes, ports, terminal
F38 Node drawer: OS, kernel, runtime, kubelet, zone/region, capacity vs allocatable, conditions, taints
F39 Node shell: a root shell on the node (privileged pod + nsenter), configurable image
F40 Cordon, uncordon, and PDB-aware drain (Eviction API)
F41 Port-forward manager: persistent tunnels, auto-port, one list of every tunnel
F42 Local terminal bound to a chosen cluster context with the user's own tools

## Helm
F43 Helm releases streamed live from the moment a cluster connects (no polling)
F44 A release opens on an Overview listing every object it created, grouped, with live status, hooks and notes
F45 Release history, values, manifest, upgrade with edited values, rollback, uninstall
F46 Install charts from the user's repos (chart browser/store)

## GitOps
F47 Argo CD view: Application sync, health and drift per resource, Hard Sync, no Argo CD login needed
F48 Flux view: Kustomizations and HelmReleases Ready state, what each manages, drift Flux already corrected

## Insights
F49 Workloads Overview: what's broken and why, rollouts, node pressure, Service health and DNS checks
F50 SPOF Radar: single replica without a PDB, replicas all on one node, Services with exactly one Ready backend
F51 Cost/Waste: efficiency score, idle capacity, requests by namespace/pod/node, usage vs requests (p95), GPU use
F52 Node consolidation simulation, spot disruption risk, headroom forecast, unusual-usage detection
F53 Right-sizing: VPA or p95-based recommendations, dry-run preview, copy patch, one-click apply, GitOps revert warning
F54 Upgrade Readiness: deprecated/removed API versions in the next two Kubernetes minors
F55 NetworkPolicy connectivity matrix and policy list
F56 NetworkPolicy coverage gaps and a "can pod A reach pod B?" evaluator
F57 NetworkPolicy builder form with dry-run, and a live network connectivity test
F58 Topology: a namespace as a live graph of Deployments, ReplicaSets, pods and Services

## Security
F59 Vulnerabilities page from Trivy-Operator: one row per workload, worst first, fixable counts, CVE drawer, one-click Trivy-Operator install
F60 RBAC "Who can <verb> <kind>?" explorer
F61 RBAC findings: wildcards, escalate/bind/impersonate, Secrets read cluster-wide, exec cluster-wide, bindings to missing ServiceAccounts
F62 "My access": check what the current identity may do
F63 Attack paths: outside traffic -> NetworkPolicy -> CVEs -> RBAC joined into chains per workload
F64 Workload checks: Secrets in env vars, default ServiceAccount token automount, unreferenced Secrets, unused ServiceAccounts
F65 Image-signature coverage checks (detects Kyverno, Sigstore policy-controller, Ratify, Connaisseur)
F66 Security events from the API server's audit log; exportable findings report; compliance framework control IDs

## Autoscaling
F67 KEDA page: ScaledObjects in plain words, HPA conflicts, scale-to-zero, unused TriggerAuthentications, creation wizard, Paused state, search + All view
F68 Karpenter page: NodePools, spot vs on-demand, unschedulable pods, edits that warn before evicting
F69 Install a VPA recommender from the app

## AI
F70 MCP server: off until the user ticks clusters; reads allowed clusters; proposed changes approved one by one
F71 Audit log of every change made through the app and every AI/MCP call, stored locally

## Delivery and trust
F72 Desktop app for macOS, Windows, Linux
F73 Standalone engine binary / Docker image serving the web UI
F74 In-cluster Helm chart with OIDC sign-in that impersonates the user so cluster RBAC applies
F75 No account, no telemetry or phone-home, open source licence
F76 Local engine protected by a session token; Secret values are never loaded into tables
F77 Release checksums (.sha256) and build-provenance attestation
F78 Signed cosign bundles for release assets and an air-gapped install bundle (documented for v0.8: verify whether shipped)
