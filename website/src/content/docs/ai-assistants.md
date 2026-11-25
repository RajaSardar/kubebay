---
title: AI assistants (MCP)
description: Let Claude or another MCP client read the clusters you choose through Kubebay, and propose changes you approve one by one.
section: Integrations
order: 7
appRoutes: []
---

Kubebay has an MCP server, so an AI assistant such as Claude Desktop or Claude Code can read your clusters through it. It's off until you turn it on, and then it reads only what you allow.

## Turning it on

In **Settings → AI assistants (MCP)**:

1. Tick the clusters an assistant may read. For each one, leave the namespaces empty for all of them, or list some, such as `shop, payments`.
2. Click **Turn on**.
3. Connect your assistant. Kubebay shows what to copy:
   - **Claude Desktop**: a block to add to `claude_desktop_config.json` (Settings → Developer → Edit Config). Then restart Claude Desktop.
   - **Claude Code**: one command to run in a terminal, `claude mcp add --scope user kubebay -- …`.

Both start Kubebay's bridge (`kubebay mcp-stdio`), which reads the connection details Kubebay writes when MCP is on.

While MCP is on, the sidebar shows **AI access on**. **Turn off** stops it and revokes the token, so it's also the kill switch. **Rotate token** issues a new token and disconnects clients that connect directly rather than through the bridge.

## What an assistant can do

| Tool | Does |
|---|---|
| `list_clusters` | The clusters you allowed, with reachability and version |
| `get_cluster_health` | Node readiness, pods that aren't running or ready (with the reason), and the most frequent warnings |
| `list_resources` | Resources of one kind as compact rows |
| `describe_resource` | Why a resource is unhealthy: for a pod, each container's image, state, restarts and last termination |
| `get_logs` | Recent log lines of one container, repeats collapsed, capped at 40 KB |
| `list_events` | Events grouped by object and reason, warnings only by default |
| `get_manifest` | A resource's YAML, without managedFields |
| `propose_change` | Proposes a change. It changes nothing by itself. See below |
| `get_proposal_status` | Whether a proposal is pending, applied, rejected, expired or stale |

Secrets are never available: they aren't listed, and ConfigMaps are listed by name only. Environment values are redacted.

Every call is written to the [Audit Log](/docs/audit-log/), and the last ten are listed under **Recent assistant calls** with the time, tool, cluster and assistant.

## Proposed changes

Tick **Let assistants propose changes** to allow `propose_change` on workloads, Services and Ingresses in the clusters you allowed.

A proposal changes nothing. Kubebay shows it to you with the assistant's reason, in its own words, and the exact diff. **Approve and apply** applies exactly that diff, and only if the object hasn't changed since the proposal was made. **Reject** turns it down, and **Decide later** keeps it waiting. Turning this off, or turning MCP off, rejects whatever is waiting.

## Read-only mode

An operator can start the engine with `--mcp-read-only` (or `KUBEBAY_MCP_READ_ONLY=true`) to make the MCP server read-only whatever Settings says. Then `propose_change` and `get_proposal_status` are not listed to assistants, a call to either is refused with a message saying the MCP server is read-only (and recorded in the Audit Log as `mcp:refused:<tool>`), and the server's instructions tell the assistant it can only read. **Let assistants propose changes** shows unticked and disabled with the reason; the choice you saved is kept and applies again when the engine starts without the flag. On a shared engine (in a cluster, with OIDC sign-in or behind an auth proxy) the MCP server is not served at all, so the box is shown unticked and disabled and only the operator can change it; `POST /api/mcp` answers 403 there. The Helm chart has `mcp.readOnly` (default `false`), which sets `KUBEBAY_MCP_READ_ONLY=true`: because the chart already runs a shared engine, this only adds a second lock. `GET /api/settings` reports `mcpReadOnly` with `mcpReadOnlyReason` when writes are off for either reason, and `mcpLocked` on a shared engine. The same hiding happens when the box is simply unticked. Every tool is classified as read or write in code, and a test fails if a new one isn't. This was tested with fakes and HTTP tests, not against a live cluster or a real assistant.

## Benchmark harness

`scripts/mcp-bench` in the repository drives the server through ten fault scenarios on a dedicated kind cluster and records pass or fail and time per scenario in a JSON file. You give it a `--kubeconfig` that must be a file named `kind-*` (never the default `~/.kube/config`, nor a link to it) whose contexts are all `kind-*`. With `--engine <binary>` it starts the engine itself with only that kubeconfig and a temporary home; with `--url` it refuses to run unless every cluster the server lists is in that kubeconfig. Its `--read-only` check only lists the tools and never calls a write tool. Baseline numbers have not been measured yet, and the `--engine` path has not been run against a real engine.

## Where it's available

MCP is part of Kubebay on your own machine, with the engine listening on a loopback address. It isn't available when the engine runs in a cluster or with OIDC sign-in, and the card says why.
