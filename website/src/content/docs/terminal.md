---
title: Terminal
description: A shell on your own machine, in a dock under every page, bound to the cluster you pick, with kubectl and your other tools.
section: Tools
order: 1
appRoutes: ["/terminal"]
---

**Terminal** opens a shell on your own machine: your shell, your `PATH`, and your tools, such as `kubectl`, `helm`, `stern` and `k9s`. It's bound to one cluster. For a shell inside a container, use a pod's [Terminal tab](/docs/pods/#terminal). For a shell on a node, use [node shell](/docs/nodes/#node-shell).

## The dock

The terminal lives in a dock under the page, above the status bar. The sidebar stays beside it at full height. The shell keeps running while you move between pages, so you can look something up and come back to your command and its output. Hiding the dock doesn't end the shell either, or resize it.

Open it any of these ways:

- Press <kbd>Ctrl</kbd>+<kbd>`</kbd> anywhere, on every OS. If the dock is open, the same keys focus the shell. From inside the shell they hide the dock and put focus back where it was.
- Click **Terminal** in the status bar. It shows the key, and while a shell is running, the context it's bound to.
- Click **Terminal** under Tools in the sidebar. It opens the dock without leaving the page you're on.
- Open a `/terminal` link. It opens the dock and goes back to the page you were on, or to the Overview.

Nothing else moves focus into the shell. Pages, drawers and extensions never do.

Drag the dock's top edge to resize it, or focus the edge and use <kbd>↑</kbd> and <kbd>↓</kbd> (16 px a press). Double-click the edge to reset it. Kubebay keeps the height on this machine. After a restart the dock starts hidden, with no shell running.

The dock's header shows **Terminal · \<context\>**, then **End shell**, **Hide** and the ⓘ. **End shell** ends the shell. After that, the dock offers **Open a shell on \<context\>** and waits for you to click it.

While the dock is open, a resource drawer ends above it, and pressing in the dock leaves the drawer open. Pressing on the page still closes it.

### Keys in the shell

The shell gets your keys, including <kbd>Ctrl</kbd>+<kbd>K</kbd>, <kbd>Ctrl</kbd>+<kbd>W</kbd>, <kbd>Ctrl</kbd>+<kbd>R</kbd>, <kbd>Esc</kbd> and <kbd>Tab</kbd>. Three keys are kept out of it:
- <kbd>Ctrl</kbd>+<kbd>`</kbd>, which belongs to the dock;
- the drawer's <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd> and <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>, which do nothing while you type in the shell.

## Bound to a context

A shell opens on the kubeconfig context of the cluster you're looking at. Its name is in the dock's header. `kubectl` in it targets that context, without `--context`.

It doesn't follow the cluster picker. If you switch clusters, the dock says **Kubebay now shows …. This shell stays on … until you say otherwise.** Choose **Keep this shell** or **Open a shell on** the new context. Opening a new one ends the old session and its scrollback, so Kubebay asks first.

### Contexts that read like production

If the context's name reads like production (`prod`, `prd`, `live`, `production`), the first shell doesn't open by itself. Kubebay asks **Open shell on …**, and opens it after a second click. While it runs, the dock's header and the status bar show a **production** pill. It's a check of the name only: Kubebay can't tell what the cluster really is, and a name that looks harmless proves nothing. **Restart** asks first too.

### When a shell ends

When the shell exits, the dock says **Session ended** with its exit code and offers **Restart**. If the connection to the engine drops, the shell's process is gone: the dock says so and offers **Restart**, which waits until the engine is back. What you type while the connection is down is dropped. It's never sent later to a new shell.

### How the binding works

Kubebay writes a small kubeconfig that holds only a `current-context`: no clusters, no users, no tokens. The shell gets `KUBECONFIG=<that file>:<your own files>`. Your credentials stay where they are, and `kubectl config use-context` in the shell changes the throwaway file, not your own kubeconfig.

## Where it's available

The local terminal is part of the desktop app. The standalone engine and the container image don't include it: the status bar has no **Terminal**, and the dock says **This engine build has no local shell.** It's also off in a cluster and with OIDC, where the shell would be the server's, not yours.

## Commands from extensions

An [extension](/docs/extensions/) can add a row action that runs a command, such as `stern` for a Deployment. Kubebay never types it into a shell that's already running, because something else may be running there, like an editor.

- **With no shell running:** Kubebay opens one on the row's cluster and types the command at the prompt, without pressing <kbd>Enter</kbd>. On a context that reads like production, it asks first. A note says the command was **Typed from your extension**. You read it, then run it or clear it.
- **With a shell running:** the dock shows the command with **Copy**. If the shell is on the row's cluster, it also offers **Type into this shell**. If not, it offers **Open a shell on** the row's cluster, which asks first because it ends the current shell.

A newer command replaces one that's still waiting.
