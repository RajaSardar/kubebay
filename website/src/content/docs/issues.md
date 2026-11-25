---
title: Issues
description: One ranked list of what is wrong in the cluster, with an Investigate button that opens the evidence.
section: Insights
order: 1
appRoutes: ["/issues"]
---

**Issues** in the sidebar's Tools is one list of what is wrong in the connected cluster, worst first. It gathers what the other pages already find, so you don't have to visit each of them to learn where to start.

Each row shows the severity, the object (its kind and name), its namespace, one line on what is wrong, how long it has been wrong, and which check raised it. **Investigate** opens the evidence: a pod issue opens the worst pod's drawer, an object issue opens that object's page, and a risk that belongs to a whole page opens that page. It does not jump to a particular check or filter on the page it opens; if the page has the finding, you will see it there.

## Where issues come from

An issue is never made up. Each one is raised by a check that already exists in Kubebay, and its **Raised by** column names it.

| Raised by | What it reports | Severity |
|---|---|---|
| Needs attention | A workload with pods that crash, can't pull their image, can't be scheduled, or aren't ready (the same rule as the [Overview](/docs/workloads-overview/)'s Needs attention). It investigates the pod with the most restarts. | Critical when none of a Deployment, StatefulSet or DaemonSet's pods is ready, high for other failures, medium for warnings such as an eviction or a pod stuck pending |
| Node conditions | A node that is not Ready, or reports memory, disk, process or network pressure. | Critical for not Ready, medium for pressure |
| Service health | A Service whose selector matches no pods, or whose pods are all not ready. | High when no pod is ready, medium when the selector matches nothing |
| Certificates | A cert-manager Certificate that has expired, is not Ready, or expires within 14 days. A Certificate still being issued (not Ready for under 10 minutes) is left out. Only when cert-manager is installed. | Critical for expired, high for not Ready or expiring |
| SPOF Radar | A single replica with no PodDisruptionBudget, replicas all on one node, or a Service with one ready backend. | Medium |
| Network policy coverage | A group of pods that no NetworkPolicy selects. | Medium when the namespace has no policy at all, low otherwise |
| Best practices | A failed check of Critical severity. A check you have set aside with an exception on the [Best practices](/docs/best-practices/) page is left out. Certificates are covered by the row above. | Critical |
| Upgrade readiness | An API version the cluster still serves that a coming Kubernetes release removes. | High when the removal is one minor release away or already due, medium otherwise |

## Order

The list is ordered by severity first. Within one severity, problems that are failing now come before latent risks (SPOF, network policy gaps, best practices, upgrade readiness). Then the ones that touch more pods come first, then the oldest, then by name so the order doesn't shuffle. Issues with no known age come last. A Network policy gap or a best-practice check counts as one item, so it never outranks something that is failing.

## Filtering

The severity, kind and namespace pickers narrow the list. The count badges above them always show every issue in the cluster. The list is for the cluster you have selected; switching cluster empties it and starts again.

## What is not checked

Issues reads the same live streams the other pages use and adds no new request of its own, apart from the API discovery lists that Best practices and Upgrade readiness already fetch. A check can only report what your own permissions let you read. When a check can't run, because the data is still loading, your access doesn't allow reading it, or the cluster doesn't have the feature, a banner names it with the reason. **A missing check is never shown as all clear:** "No issues found" appears only when every check ran.

It does not include the RBAC explorer's findings, because those need a heavy scan of the cluster, or any Secret contents. Nothing here changes the cluster: Investigate only opens a page. **Investigate with AI** hands the issue to your own Claude Code and shows its answer; it can only read, and any fix is yours to apply. See [AI assistants](/docs/ai-assistants/).
