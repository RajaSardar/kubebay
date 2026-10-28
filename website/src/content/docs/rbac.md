---
title: RBAC and security
description: Who can do what, risky permissions, attack paths, secrets in environment variables, unused accounts and Secrets, image signatures, and security events from the API server's audit log.
section: Insights
order: 1
appRoutes: ["/rbac"]
---

**RBAC** in the sidebar's Tools is Kubebay's security page. Every check reads objects through the Kubernetes API with your own credentials. Nothing is installed in the cluster. The checks are stacked as cards, each one independent.

## Who can …

Pick a verb, a resource and, optionally, a namespace, then **Query**. Kubebay lists every user, group and ServiceAccount that has that access, and the binding that gives it to them. For example, *who can `create` `pods/exec` in `payments`*.

## Findings

Real subjects holding a risky permission through a real binding. A risky role that nothing binds isn't flagged:

- a wildcard verb, resource or API group (`*`);
- privilege-escalation verbs: `escalate`, `bind` or `impersonate`;
- reading Secrets cluster-wide;
- `exec` into pods cluster-wide;
- a binding to a ServiceAccount that doesn't exist.

System bindings are hidden by default. **Show who else has this** runs the matching *Who can …* query.

## My access

**Run SelfSubjectAccessReviews** asks the API server what your own identity can do: list, create and delete pods, update Deployments, get Secrets, and list nodes.

## Attack paths

Findings joined into chains that start where traffic from outside the cluster lands: a LoadBalancer or NodePort Service, an Ingress, or a Gateway API HTTPRoute. For each workload it reaches, Kubebay asks:

1. Does a NetworkPolicy keep that traffic out?
2. Do the pods run images with critical or high CVEs, a **foothold**? This needs Trivy-Operator.
3. Does the pods' ServiceAccount token carry risky RBAC, or can they break out to the node through a privileged container or a `hostPath` volume? That's a **payoff**. Kubebay also names the Secrets the token can read.

Exposure alone isn't a path. A chain is listed only when it has a foothold or a payoff.

## Workload checks

- **Secrets exposed via environment variables**: workloads that pass Secrets through `env` or `envFrom` rather than a mounted volume. Environment variables are easier to leak, through process dumps, child processes or logs.
- **Default ServiceAccount token automount**: workloads that run as the `default` ServiceAccount with its API token still mounted.
- **Unreferenced Secrets**: Secrets no pod, workload, ServiceAccount or Ingress refers to. Kubebay reads only their names and metadata, never their values.
- **Unused ServiceAccounts**: ServiceAccounts nothing runs as, with the bindings that grant them access and whether they have a long-lived token.

## Image signatures

- **Image signature verification**: whether a policy engine enforces signed images: Kyverno, Sigstore policy-controller, Ratify or Connaisseur. Each namespace is **Enforced**, **Partly enforced**, **Audit only** or **Not verified**.
- **Running image signatures**: whether a signature is published for each image digest that's actually running. It contacts each image's registry, so it runs only when you ask. Choose anonymous access or the pods' own pull secrets.

## Audit-log security events

Reads your API server's audit log and lists the events worth a look:

| Severity | Event |
|---|---|
| High | Anonymous request allowed |
| High | Exec into pod, Attach to pod |
| High | Privileged or host-namespace pod created |
| High | Binding to cluster-admin |
| Medium | Port-forward to pod |
| Medium | Pod with a hostPath volume created |
| Medium | ClusterRoleBinding changed |
| Low | Secret read by a person |

Point it at a **log file on this machine**, **EKS (CloudWatch Logs)** or **GKE (Cloud Logging)**. Kubebay reads the newest part of the log. Audit logging must already be on for your cluster.

## Export report

**Export report** saves one report of every check's findings for this cluster, as **SARIF**, **JSON** or **Markdown**. It covers this page's checks, [SPOF Radar](/docs/workloads-overview/#spof-radar), NetworkPolicy coverage and [upgrade readiness](/docs/upgrade-readiness/). Share it, attach it to a ticket, or upload the SARIF to a code-scanning tool.
