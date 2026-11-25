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

### Sign in through an auth proxy

Instead of OIDC, the chart can take the signed-in user from an authenticating reverse proxy in front of the engine (oauth2-proxy, an ingress with auth, a corporate gateway). The proxy signs people in and adds their name, and optionally their groups, as request headers. The engine then treats that person exactly like an OIDC user: it acts as them through impersonation, so RBAC decides what they see, each person gets their own caches, the audit log records their name, and everything in the list above applies, including the read-only settings and no usage history. You turn it on with `authProxy.enabled`. It can't be on together with OIDC, and the engine refuses to start if both are set.

The rules that keep it safe:

- **Only the connection counts.** The engine reads the identity headers only when the connection comes from an address inside `authProxy.trustedCIDRs`. It looks at the address the TCP connection came from. It never reads `X-Forwarded-For`, `Forwarded` or `X-Real-IP`, because a client can set those.
- **No anonymous fallback.** A request from any other address gets 401 on every page and endpoint, whatever headers it carries, and so does a request from the proxy without a user header. The launch token is not a way in. Only `/api/healthz` (for the Kubernetes probes) and `/api/auth-mode` stay open.
- **Checked values.** A user or group is at most 256 bytes. There can be at most 64 groups and the groups header is at most 8 KiB. Control characters, line breaks and invalid UTF-8 are refused, and so are a duplicated user header and an empty group. A bad request is refused whole, never partly used. Users that start with `system:` and the `system:masters` group are refused unless you set `authProxy.allowSystemIdentities`.
- **Start-up refusals.** The engine won't start with no trusted range, with `0.0.0.0/0` or `::/0`, or with a range wider than a /24 (IPv4) or /64 (IPv6) and no shared secret, unless you set `authProxy.allowAnyPeer` to say you accept the risk.
- **No cross-site actions.** The proxy adds your identity to everything your browser sends, so the engine refuses a change (or a WebSocket upgrade) that the browser marks as coming from another site, using the `Sec-Fetch-Site` header. Requests without that header are not affected.
- **A shared secret.** You can have the proxy send a secret in a header you name (`authProxy.secret.header`). The engine reads the secret from a mounted Secret file, never from a value in the chart, and compares it in constant time.

**Any other pod inside the trusted range can pretend to be anyone.** Keep `trustedCIDRs` to the proxy's own addresses, set the secret header if you can't, and add a NetworkPolicy so that only the proxy can reach the engine's port. If the proxy reaches the engine from a node address (the ingress source-NATs), the engine sees the node, not the proxy: use `externalTrafficPolicy: Local` or run the proxy inside the cluster. The engine does not check a signed token from the proxy; it trusts the connection and the headers.

The MCP endpoint, the local terminal, extensions, AI triage, the shared audit feed and cluster disconnect are off here as they are with OIDC. Not run against a live cluster or a real proxy: the rules above are covered by unit and HTTP tests.

**Durable audit log:** the engine's settings are written to a 64Mi `emptyDir` and are lost when the pod restarts or moves. The [Audit Log](/docs/audit-log/#in-a-cluster) is also printed to the engine's output as JSON lines, one per change, so a log collector can keep it, and `auditLog.persistence.enabled` keeps the file on a PersistentVolumeClaim. Anyone who can read the engine pod's logs can read every user's lines. The cluster's API server audit log is the other record: every change Kubebay makes there carries the signed-in user's name, because the engine impersonates them.

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
