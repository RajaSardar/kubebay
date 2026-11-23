---
title: Security and privacy
description: What Kubebay can reach, how the engine is protected on your machine, how it handles Secrets, and what it sends anywhere.
section: Reference
order: 2
appRoutes: []
---

## Your credentials

Kubebay uses your kubeconfig as `kubectl` does. It doesn't copy your credentials, and never syncs them anywhere. Exec plugins such as `aws eks get-token` and `gke-gcloud-auth-plugin` run as they would in your terminal.

The desktop app is started by your OS, not a shell, so it reads a short list of variables from your login shell: `PATH`, `KUBECONFIG`, the AWS and Google Cloud profile and config variables, and proxy and CA settings. That way an exec plugin signs in as the same identity your terminal uses. Without `AWS_PROFILE`, for example, it would quietly fall back to the `default` profile. Nothing else from your environment is passed on.

## The engine on your machine

- It listens on `127.0.0.1` by default, and rejects requests whose `Host` isn't a loopback address. A web page you visit can't reach it through DNS rebinding.
- Every request needs this session's token. The token is written to a file only you can read (mode 0600) and is never logged. It changes each time the engine starts. The desktop app passes it to its own window, so you never see it.

## In a cluster

With the Helm chart and OIDC, users sign in with your identity provider. The engine then acts **as that user**, through Kubernetes impersonation, so the cluster's own RBAC decides what each person can see and do. Kubebay never grants more than RBAC does. That includes what the engine collects or reaches under its own identity:

- **Workload usage on [Cost / Waste](/docs/cost-waste/#workload-usage-vs-requests).** The usage sampler runs as the engine's ServiceAccount, so each person only sees the workloads in namespaces where they may list pods. Kubebay asks the API server, as that person, before it shows a namespace. If it can't get an answer, it shows nothing.
- **Prometheus.** By default, your queries go through the API server's service proxy, as you, so RBAC on the Prometheus Service decides. If the operator sets a Prometheus URL for the engine, that URL answers for every namespace, whatever RBAC says. So signed-in users can only query it once the operator turns on `prometheus.allUsers`.
- **Settings that apply to everyone are read-only.** One engine serves every user, so the node shell image, the debug image, the Prometheus URL and pinned Prometheus Service, and the kubeconfig sources can't be changed from Settings. Otherwise one person could choose the image of the privileged pod that another person's [node shell](/docs/nodes/#node-shell) runs with their own credentials. The operator sets them in the chart's values. See [Install in a cluster](/docs/install/#in-a-cluster).
- **Helm repositories are read-only.** Every user's chart installs resolve a `repo/chart` name against the same repository list, so nobody can **Add repository**, point an existing name at a new URL, or **Remove repository** from the [Helm store](/docs/helm/#adding-and-removing-repositories). Otherwise one person could choose where another person's charts come from. Anyone can still refresh the indexes of the repositories that are there. The operator lists them in the chart's `helmRepos` value or the engine's `--helm-repos` flag.
- **No usage history.** The usage sampler reads every namespace with the engine's own identity, so with OIDC usage history isn't recorded, whether the engine runs in a cluster or not, and nobody can turn it on or erase it for everyone.

Features that only make sense on your own machine are off in a cluster: the local terminal, extensions, AI assistants (MCP), AI triage and usage history. Usage history is also off when OIDC is configured on an engine that doesn't run in a cluster.

**Known limitation:** the engine's [Audit Log](/docs/audit-log/) and settings are written to a 64Mi `emptyDir`, so they're lost when the pod restarts or moves, and the chart has no option for a persistent volume yet. If you need a lasting record, rely on the cluster's API server audit log. Every change Kubebay makes there carries the signed-in user's name, because the engine impersonates them.

## Secrets

- Secret values aren't loaded into tables. A Secret table shows names and metadata only.
- An environment variable from a Secret stays masked until you click to show it, and every reveal is recorded in the [Audit Log](/docs/audit-log/).
- A Secret opened in its drawer shows its keys with the values hidden, and so does its `last-applied-configuration` annotation, which would otherwise hold a second copy. **Reveal values** on the YAML tab loads them, and that is recorded in the Audit Log too. Until you reveal them, you can edit the Secret's labels and other fields, but not its values.
- The [security checks](/docs/rbac/) that look for unused Secrets read only their names and metadata.
- AI features never see Secrets. MCP doesn't list them, and triage masks credentials in the evidence before you send it.

## What Kubebay sends, and where

| What | Where | When |
|---|---|---|
| Kubernetes API calls | Your clusters | While you use them |
| An update check | GitHub releases | Desktop app only: 30 s after launch, then daily. Turn it off in Settings |
| Image signature lookups | Each image's registry, and Sigstore | Only when you run a signature check |
| Prometheus queries | Your Prometheus | When you set a URL, or one is detected |
| Triage evidence | The endpoint you set | Only when you click Send |
| Cloud cluster listings | Your `aws`, `gcloud` or `az` CLI | Only when you click Find |

There's no telemetry, no account and no licence server.

## Releases

Every release asset is signed with cosign, keylessly, and has a GitHub build-provenance attestation. See [Verify a download](/docs/install/#verify-a-download). Desktop updates install only after their signature checks out against the key built into the app.

## Reporting a vulnerability

Use GitHub's private [Report a vulnerability](https://github.com/RajaSardar/kubebay/security/advisories/new). Please don't open a public issue.
