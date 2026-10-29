---
title: Audit Log
description: Every change you made through Kubebay, and every call an AI assistant made, on your own machine.
section: Tools
order: 5
appRoutes: ["/audit"]
---

**Audit Log** in the sidebar's Tools lists the last 500 things you've done through Kubebay, newest first. Each entry has the time, the action, the cluster, the namespace, the resource and any detail, such as the replicas you scaled to or the command you ran. Click an entry for all of its details.

Recorded actions include:

- changes: apply, create, delete, scale, restart, resize, cordon, drain;
- Helm installs, upgrades, rollbacks and uninstalls;
- sessions: a container shell, the local terminal, a port-forward, a network diagnostic pod;
- revealing a Secret's value;
- a change an admission policy rejected, marked as rejected;
- every call an AI assistant made through [MCP](/docs/ai-assistants/), reads included, marked as coming from MCP.

**Filter by action, cluster, resource…** narrows the list.

The log is a file on your machine: `audit.log` in Kubebay's folder in your user config directory (`~/Library/Application Support/kubebay` on macOS, `~/.config/kubebay` on Linux, `%AppData%\kubebay` on Windows). It's never sent anywhere.

This is Kubebay's own record of what you did with it. Your cluster's API server audit log is a different thing: to read security events from that, see [Audit-log security events](/docs/rbac/#audit-log-security-events).
