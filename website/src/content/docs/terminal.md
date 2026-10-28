---
title: Terminal
description: A shell on your own machine, bound to the cluster you pick, with kubectl and your other tools.
section: Tools
order: 1
appRoutes: ["/terminal"]
---

**Terminal** opens a shell on your own machine: your shell, your `PATH`, and your tools, such as `kubectl`, `helm`, `stern` and `k9s`. It's bound to one cluster. For a shell inside a container, use a pod's [Terminal tab](/docs/pods/#terminal). For a shell on a node, use [node shell](/docs/nodes/#node-shell).

## Bound to a context

A terminal opens on the kubeconfig context of the cluster you're looking at. It says **Bound to context … (cluster …)**. `kubectl` in it targets that context, without `--context`.

It doesn't follow the cluster picker. If you switch clusters, the terminal says **Kubebay now shows …. This shell stays on … until you say otherwise.** Choose **Keep this shell** or **Open a shell on** the new context. Opening a new one ends the old session and its scrollback, so Kubebay asks first.

### How the binding works

Kubebay writes a small kubeconfig that holds only a `current-context`: no clusters, no users, no tokens. The shell gets `KUBECONFIG=<that file>:<your own files>`. Your credentials stay where they are, and `kubectl config use-context` in the shell changes the throwaway file, not your own kubeconfig.

## Where it's available

The local terminal is part of the desktop app. The standalone engine and the container image don't include it. A browser tab opened on them says **This engine build has no local shell.** It's also off in a cluster and with OIDC, where the shell would be the server's, not yours.

## Commands from extensions

An [extension](/docs/extensions/) can add a row action that runs a command, such as `stern` for a Deployment. Kubebay opens the terminal on the row's cluster and types the command at the prompt, without pressing <kbd>Enter</kbd>. It's marked **From your extension**. You read it, then run it or clear it.
