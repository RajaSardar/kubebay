# Best practices page (backlog 36)

The ask: a place in the app that teaches Kubernetes best practice (DR, stability, reliability, security), says what to install, and jumps to the relevant Kubebay page, or shows how to install it.

## Round 1: scope proposals

**Pragmatic SRE.** Teach through the user's own cluster, not a course. Checks that matter in an incident: PodDisruptionBudgets on multi-replica workloads, resource requests and limits, readiness probes, metrics-server (HPA and `top` need it), a backup tool (Velero) for DR, an ingress controller, cert-manager for expiring certificates. Each check has a verdict and one line on why. No scoring, no scheduler.

**Security engineer.** Lead with security: NetworkPolicies per namespace, Pod Security Admission labels, a policy engine (Kyverno or Gatekeeper), an image scanner (Trivy-Operator), RBAC review, secrets handling. Wants severity ordering and CIS-style naming so findings map to a framework. Wants every check to be derivable without privileged access.

**Platform-product designer.** One page, not a nav tree. A checklist grouped by theme (Reliability, Security, Disaster recovery, Platform), each row with pass, fail or unknown, a short "why it matters", and a collapsed "How to install" for missing tools. When a tool is installed the row links to the Kubebay page that works with it. Keep the sidebar to one entry. Don't write long lessons in the app; link to docs.

## Round 2: challenges

- **SRE challenges Security:** CIS mapping and severity ordering is a compliance product, a big build with contested mappings. A page that claims a framework score and gets one check wrong loses trust. Ship plain, honest checks first.
- **Security challenges the Designer:** "unknown" must be a first-class state. A check that can't read a resource (RBAC forbids it) must not show a green pass. Also "not installed" must not mean "unsafe": a cluster may use a managed addon (for example EKS-managed backups) Kubebay cannot see. Wording has to say "not detected".
- **Designer challenges the SRE:** a per-workload list of every missing probe turns the page into a wall. Show a count and the first few offenders, and send the user to the existing table for the rest.
- **SRE challenges the Designer:** an install disclosure that runs commands is out of the question for a read-only tool. Show the command as text only, using the project's official instructions, pinned to nothing that goes stale (Helm repo commands or a `latest` release URL).

## Verdict: the smallest valuable slice

- One sidebar entry, **Best practices**, route `/best-practices`.
- A fixed, plain checklist of 11 checks in four groups, derived only from what the app already streams (Deployments, StatefulSets, PodDisruptionBudgets, NetworkPolicies, Namespaces, IngressClasses) and API discovery (which API groups exist, which tells us if Velero, cert-manager, Kyverno or Gatekeeper, Trivy-Operator and metrics-server are installed). No new engine endpoints.
- Each check is pass, fail or unknown, with a one-line why. A stream RBAC forbids gives unknown, never pass. Tool checks say "not detected".
- A missing tool gets a "How to install" disclosure with the official command as text; Kubebay never runs it. An installed tool links to Helm, Network policy or Vulnerabilities.
- Workload checks show a count and up to three offenders; kube-system, kube-public and kube-node-lease are left out.
- Deferred: a framework score (CIS), per-check exceptions, fix actions, multi-cluster comparison, more tools (backup restore tests, Prometheus alerts, secrets managers).

## Slice 2 (built)

- **Severity.** Each check is Critical, High, Medium or Low, fixed in code (`META` in `lib/bestPractices.ts`), not user-tunable and not mapped to CIS. A strip shows the pass percentage (pass over all checks, so Unknown pulls it down and is never counted as a pass), the three status counts and failing checks per severity. Filters for severity and status, and a sort by theme, severity or status.
- **13 more checks** (24 in all), again from streams and discovery only: privileged, host access, runs as root, latest tag, liveness probe, default ServiceAccount token, plain-text env secrets, LoadBalancer source ranges, PVC backup schedule (Velero Schedules), nodes Ready, node version skew, certificate expiry (cert-manager, 14 days) and HPA at max. Services, PVCs, Nodes and HPAs are new streams; Certificates and Velero Schedules open only when discovery lists the group, and when the group is absent the check says so (cert expiry passes with nothing to check; PVC backup fails with "no schedule detected", worded as detection, not proof).
- **Learn.** A short plain-language lesson and the official docs address as text, per check; no outbound fetch.
- **Limits.** Only Deployments and StatefulSets are read, so DaemonSets, CronJobs and bare pods are not covered. Secret detection is by env var name, so it will miss a credential under a neutral name and may flag a harmless literal. Checks pass or fail on declared spec, not on what runs.

## Slice 3 (built)

- **Coverage.** The workload checks now also read the pod templates of DaemonSets and CronJobs (`spec.jobTemplate.spec.template`) and bare Pods (no controller owner reference; owned pods are checked through their controller). A Coverage line lists the count per kind after system namespaces are dropped, and a kind the app couldn't read says "not read". The core Deployment and StatefulSet streams still decide Unknown; the three new kinds are additive, so a forbidden DaemonSet stream narrows coverage rather than turning every check Unknown.
- **Exceptions.** "Ignore this check" or "Ignore for namespace X", with a required reason, saved in `localStorage` under `kb.bestPractices.exceptions.<cluster>` (this browser only, no sharing). Pure `applyExceptions` turns a check into the fourth status, Ignored: never a pass, left out of the score denominator, counted visibly (`Ignored N`), undoable per exception. A namespace exception filters the full offender list (`allOffenders`) and ignores the check only when nothing remains. Cluster-wide checks (nodes) offer no namespace scope.
- **CIS reference tags.** `cis` in `META`, shown as "CIS x.y.z" and labelled a reference: 5.2.2 privileged, 5.2.7 root containers, 5.3.2 NetworkPolicies, 5.1.6 ServiceAccount token mounting (v1.8 numbering). Pod Security labels, policy engine, host access (bundles hostPath, which CIS does not cover) and secrets in env (CIS 5.4.1 is about Secret-backed env, a different question) are deliberately untagged. Still no framework score.
- **Export.** `BestPracticesExport` follows the `FindingsExport` pattern (modal, Save buttons, `save` and `stamp` shared from it): JSON and Markdown carrying checks, summary, coverage, references and ignore reasons. No SARIF.
- **Still deferred.** More tools, fix actions, sharing exceptions across machines or teammates, expiry dates on exceptions.

## Slice 4 (built)

- **Framework scores.** Pure `frameworkScores` in `lib/bestPractices.ts`: one score per pillar (the existing groups Security, Reliability, Disaster recovery, Platform) plus **CIS-referenced**, over only the checks carrying a CIS tag. Worked out like the overall score: pass over checks not ignored, Unknown counts against, a framework with every check ignored gives `null` ("all ignored"), a framework with no checks is left out. The CIS figure is labelled as covering Kubebay's tagged checks only, not a CIS compliance score, which answers Round 2's worry about claiming a framework score.
- **Fix actions.** Pure `fixFor` in `lib/bestPracticesFixes.ts`, for four failing checks only: a PodDisruptionBudget per multi-replica workload (`<name>-pdb`, the workload's own `spec.selector`, `maxUnavailable: 1`), a `default-deny-ingress` NetworkPolicy per namespace (ingress only, so DNS egress keeps working), Pod Security labels on the namespace (enforce `baseline`, warn and audit `restricted`), and `automountServiceAccountToken: false` on the pod template of each Deployment, StatefulSet, DaemonSet or CronJob as a partial object (bare pods are left out with a note, since a pod can't be changed in place). It works from `allOffenders` after exceptions, so ignored namespaces get no YAML. **Fix** opens the multi-document YAML in a dock **New resource** tab (`terminalDock.openNewTab`), where the user reviews, dry-runs and applies it through `POST /api/yaml/create` (server-side apply, field manager `kubebay`, no force, so a field another manager owns is a conflict, with the production confirmation). Nothing is applied by the page. Every string in the YAML is double-quoted by a small writer (`toYaml`), and keys YAML 1.1 reads as booleans are quoted, so names such as `123` or `on` stay strings. Comments sit inside each document because the engine splits on `---` and a comment-only document would fail. A PodDisruptionBudget template was added to Create Resource so the kind picker matches the YAML.
- **No Fix** where the right change depends on the app or on something only the user knows: probes, requests and limits, image tags, privileged, root, host access, env secrets, LoadBalancer source ranges, tools, nodes and certificates.
- **CIS numbers re-checked.** The four tags were compared with the control ids in kube-bench's `cfg/cis-1.8/policies.yaml` and `cfg/cis-1.10/policies.yaml` (aquasecurity/kube-bench, main): 5.1.6 "Ensure that Service Account Tokens are only mounted where necessary", 5.2.2 "Minimize the admission of privileged containers", 5.2.7 "Minimize the admission of root containers", 5.3.2 "Ensure that all Namespaces have NetworkPolicies defined". All four match in both versions, so no tag changed. That is kube-bench's transcription of the benchmark, not the CIS PDF itself, which was not read.
- **Unverified.** The generated YAML has been tested as text only; it has not been dry-run or applied against a live cluster. Server-side apply of the partial Deployment and Namespace objects is expected to merge into the existing objects, but that was not run.
- **Still deferred.** Fixes for the other checks, a Fix per single offender, sharing exceptions, expiry dates on exceptions.
