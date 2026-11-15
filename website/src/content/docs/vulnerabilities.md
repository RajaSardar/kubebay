---
title: Vulnerabilities
description: Every CVE Trivy-Operator has found on the cluster, one row per workload, worst first.
section: Insights
order: 2
appRoutes: ["/vulnerabilities"]
---

**Vulnerabilities** in the sidebar's Tools lists every CVE that [Trivy-Operator](https://aquasecurity.github.io/trivy-operator/) has found in the cluster's images, in the namespaces you've picked.

## The list

One row per workload, worst first: by critical CVEs, then high, medium and low. Workloads whose scans came back clean aren't listed.

Columns: Workload, Kind, Namespace, Critical, High, Medium, Low, **Fixable** (CVEs with a fixed version available), the images scanned, and when they were scanned.

Trivy-Operator scans a pod's ReplicaSet. Kubebay counts those reports under the ReplicaSet's Deployment, so a Deployment is one row however many ReplicaSets it has had.

**Filter by workload, image, CVE or package…** matches the workload's name, namespace and kind, its images, its CVE ids, and the affected packages. For example, `openssl` or `CVE-2024-6387`. The header then counts *N of M workloads*.

## A workload's CVEs

Click a row to open its CVEs in a drawer: critical and high first, then **Show all** for the rest. Each CVE shows its severity, the installed version and the fixed version (or *no fix available*), and a link to its advisory. **Open workload** goes to the workload's own page.

## From a pod or workload

A pod's drawer, and a Deployment's, StatefulSet's or DaemonSet's, has a **Vulnerabilities** tab. It shows the counts, and **Open on the Vulnerabilities page** opens this page with that workload's CVEs.

## Installing Trivy-Operator

If Trivy-Operator isn't in the cluster, the page says so and offers to install it with Helm. It then scans each workload's images in the background. A workload shows up here once it's been scanned.

Trivy-Operator's raw reports are also under **Admission** in the sidebar, as Vulnerability Reports.
