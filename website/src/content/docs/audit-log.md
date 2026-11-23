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
- sessions: a container shell, the local terminal, a port-forward, a network diagnostic pod;
- revealing a Secret's value, or all of a Secret's values with **Reveal values** on its YAML tab;
- a change an admission policy rejected, marked as rejected;
- every call an AI assistant made through [MCP](/docs/ai-assistants/), reads included, marked as coming from MCP.

**Filter by action, user, cluster, resource…** narrows the list.

## Who acted

**User** is the person who signed in through OIDC (their email, or their username when the provider sends no email) when Kubebay runs as a shared server with OIDC sign-in. Everywhere else it's `local`: the desktop app, an engine on your own machine, and AI assistants calling through MCP, which use the engine's own token. Approving an assistant's proposed change records the person who approved it. Entries written before Kubebay recorded the user show **–**.

With OIDC sign-in, the Audit Log only shows your own entries. Kubebay has no admin role, so nobody sees anyone else's entries through Kubebay, and entries from before users were recorded aren't shown to anyone signed in. The whole file is still on the server for whoever runs it.

`GET /api/audit` takes `user` (exact) and `kind` (a full group/version/resource, or just the plural resource such as `deployments`) filters beside `cluster`, `namespace` and `resource`. With OIDC sign-in, `user` is always your own.

The log is a file on your machine: `audit.log` in Kubebay's folder in your user config directory (`~/Library/Application Support/kubebay` on macOS, `~/.config/kubebay` on Linux, `%AppData%\kubebay` on Windows). It's never sent anywhere.

This is Kubebay's own record of what you did with it. Your cluster's API server audit log is a different thing: to read security events from that, see [Audit-log security events](/docs/rbac/#audit-log-security-events).
