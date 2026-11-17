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
- Deferred: a framework score (CIS), severity weighting, per-check exceptions, fix actions, multi-cluster comparison, more tools (backup restore tests, Prometheus alerts, secrets managers).
