---
title: Audit Log
description: Every change you made through Kubebay, and every call an AI assistant made, on your own machine.
section: Tools
order: 5
appRoutes: ["/audit"]
---

**Audit Log** in the sidebar's Tools lists the last 500 things you've done through Kubebay, newest first. Each entry has the time, the action, the **User** who did it, the cluster, the namespace, the resource and any detail, such as the replicas you scaled to or the command you ran. Click an entry for all of its details, including **Kind**: what it acted on, as group/version/resource (`apps/v1/deployments`, `v1/pods`; Helm releases are `helm/releases`, chart repositories `helm/repositories`).

Recorded actions include:

- changes: apply, create, delete, scale, restart, resize, cordon, drain;
- Helm installs, upgrades, rollbacks and uninstalls;
- sessions: a container shell, the local terminal, a port-forward, a network diagnostic pod, and starting the Argo dashboard from the Rollouts page (`rollouts-dashboard-start`; what you do inside that dashboard is not recorded);
- revealing a Secret's value, or all of a Secret's values with **Reveal values** on its YAML tab;
- changing how long the [change timeline](/docs/changes/) is kept, and clearing it (`timeline-retention`, `timeline-clear`);
- a change an admission policy rejected, marked as rejected;
- every call an AI assistant made through [MCP](/docs/ai-assistants/), reads included, marked as coming from MCP.

**Filter by action, user, cluster, resource…** narrows the list.

## Who acted

**User** is the person who signed in through OIDC (their email, or their username when the provider sends no email) when Kubebay runs as a shared server with OIDC sign-in. Everywhere else it's `local`: the desktop app, an engine on your own machine, and AI assistants calling through MCP, which use the engine's own token. Approving an assistant's proposed change records the person who approved it. Entries written before Kubebay recorded the user show **–**.

With OIDC sign-in, the Audit Log only shows your own entries. Kubebay has no admin role, so nobody sees anyone else's entries through Kubebay, and entries from before users were recorded aren't shown to anyone signed in. The whole file is still on the server for whoever runs it.

`GET /api/audit` takes `user` (exact) and `kind` (a full group/version/resource, or just the plural resource such as `deployments`) filters beside `cluster`, `namespace` and `resource`. With OIDC sign-in, `user` is always your own.

The log is a file on your machine: `audit.log` in Kubebay's folder in your user config directory (`~/Library/Application Support/kubebay` on macOS, `~/.config/kubebay` on Linux, `%AppData%\kubebay` on Windows). It's never sent anywhere.

## In a cluster

When Kubebay runs in a cluster from the Helm chart, the file is on the pod's 64Mi `emptyDir` unless you turn on a volume, so by default it's lost whenever the pod restarts or moves. Two options keep it:

- **Stdout lines.** On by default in a cluster (`auditLog.stdout`, or `--audit-stdout` / `KUBEBAY_AUDIT_STDOUT=true` elsewhere; off on the desktop), every entry is also printed to the engine's output as one JSON object per line, for your log collector to keep: `type` (always `audit`), `time`, `user`, `action`, `gvr`, `cluster`, `namespace`, `name`, `result` (`ok`, or `rejected` when an admission webhook denied the change), and `detail`, `source` and `userAgent` when there are any. Secret values are never in an entry. Anyone who can read the engine pod's logs can read every user's lines, so treat that access like access to the whole log. Kubebay doesn't ship the lines anywhere itself; sending them to OTLP, syslog or S3 isn't built.
- **A volume.** Set `auditLog.persistence.enabled: true` and the chart creates a PersistentVolumeClaim (`size`, default 1Gi, and `storageClass`), or mounts one you made (`existingClaim`), at `/var/lib/kubebay/audit`. The claim is ReadWriteOnce.

The file can't fill its volume: at `auditLog.maxSizeMiB` (default 16) `audit.log` becomes `audit.log.1`, replacing the one before, so the two take at most twice that. The Audit Log page reads both files, and the chart refuses to render if twice the cap doesn't fit the volume. Set `KUBEBAY_AUDIT_MAX_BYTES` to cap the file outside the chart; by default there's no cap.

The cluster's API server audit log keeps its own record of each change, under the signed-in user Kubebay impersonated.

This is Kubebay's own record of what you did with it. Your cluster's API server audit log is a different thing: to read security events from that, see [Audit-log security events](/docs/rbac/#audit-log-security-events).
