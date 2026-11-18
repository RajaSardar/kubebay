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

### YAML tabs in the dock

The dock can also hold YAML editors, the same editor as a resource drawer's YAML tab. It is optional: the drawer editor stays the default. Open one with **Open in bottom dock** on a drawer's YAML tab, **Edit in dock** in a row's menu (right-click a row, or its Actions button, on a resource list or Pods), or <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>K</kbd> and **Edit YAML in dock: \<name\>**, which appears under **Edit in dock** once you've typed a search.

- Once a YAML tab exists, the dock shows a tab strip: **Shell** and **YAML \<name\>** for each object. The strip doesn't appear before then.
- Each object has one editor. Opening it again focuses its tab, and the drawer shows **Editing in dock** with **Go to tab** instead of a second editor. How many tabs you can open depends on how much text they hold (see below).
- **Close YAML tab** in the dock's header closes the active one. If it holds unapplied edits it asks **Discard changes?** first.
- **Hide** and <kbd>Ctrl</kbd>+<kbd>`</kbd> only hide the dock. A YAML tab keeps its text while the dock is hidden or you change pages. The dock keeps its height and keys as before.
- A YAML tab's label shows a dot (●) while it holds unapplied edits, and a **production** pill when its cluster's name reads like production (a name check only).
- <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>S</kbd> in a dock editor does what **Apply** does: it asks **Apply to production?** on a production-looking cluster, and does nothing when nothing changed. Use **Dry-run** to check first.
- With the focus anywhere in the dock, <kbd>Ctrl</kbd>+<kbd>PageDown</kbd> and <kbd>Ctrl</kbd>+<kbd>PageUp</kbd> move to the next and previous tab, and <kbd>Ctrl</kbd>+<kbd>W</kbd> closes the active YAML tab (asking **Discard changes?** if it has unapplied edits). On the **Shell** tab <kbd>Ctrl</kbd>+<kbd>W</kbd> still goes to the shell. <kbd>⌘</kbd>+<kbd>W</kbd> is not used: in the desktop app it closes the window.
- **Maximise** in the dock's header makes the dock as tall as it can be, for a long manifest; **Restore** puts it back.
- If the tab's cluster isn't connected, the tab says **This cluster is not connected.** Your edit stays, and **Apply** and **Dry-run** stay off until it is back.
- A tab left open can go stale. When the window regains focus, or you switch to the tab, Kubebay reads the object again. If you haven't edited, the tab quietly refreshes. If you have, it says **Changed on the cluster since you opened this.** and leaves your edit alone. **Show changes** compares the live object with what you loaded, and **Load latest** discards your edit and reloads.
- If the object is deleted on the cluster while its tab is open, the tab says **Deleted on the cluster.** and turns **Apply** and **Dry-run** off. Your text stays, so you can copy it out. **Re-create from this text** creates the object again from the editor's text, the way [Create Resource](/docs/create-resource/) does. On a cluster whose name reads like production it asks **Apply to production?** first. It isn't checked against a live cluster whether every kind accepts the text as it stands (server-set fields such as `status` are the likely snag); an error from the cluster shows in the tab.
- Tabs aren't kept across a restart: the dock starts hidden with no tabs. Unapplied text is the exception. While you edit, Kubebay keeps the text for this window only (browser session storage, never a file) and clears it when you apply, **Revert**, **Reload**, or choose **Discard**. If the window reloads or crashes, opening the same object again shows **You had an unsaved edit to this object** with **Restore unsaved edit** and **Discard saved edit**. Secrets are never kept, and neither is text over about 200 KB. Quitting the app clears it.
- Closing or reloading the window while any YAML tab holds unapplied edits asks first in the browser. The desktop app's window may close without asking; that hasn't been checked in the packaged app, which is why the text is kept as above.
- The dock holds as much editor text as a fixed budget (about 2 MB across the open tabs, each counted at 20 KB at the least), not a fixed number of tabs. When it is used up, opening another object or New resource tab shows **Not opened: the open editors already hold about as much text as the dock keeps. Close a tab, then open this one again.** with **Dismiss**. The budget is a rule of thumb, not a measurement.

### New resource tab

**Open in dock** on the [Create Resource](/docs/create-resource/) page opens a **New resource** tab with the same kind picker, templates, **Dry run** and **Apply**, and carries over any text you had typed (the page goes back to the template). The tab applies to the cluster Kubebay is showing. Each use opens its own tab, and a tab you've edited asks **Discard changes?** before it closes or before a kind switch resets its text. A New resource tab's text isn't kept after a reload.

### Keys in the shell

The shell gets your keys, including <kbd>Ctrl</kbd>+<kbd>K</kbd>, <kbd>Ctrl</kbd>+<kbd>W</kbd>, <kbd>Ctrl</kbd>+<kbd>R</kbd>, <kbd>Esc</kbd> and <kbd>Tab</kbd>. Three keys are kept out of it:
- <kbd>Ctrl</kbd>+<kbd>`</kbd>, which belongs to the dock (<kbd>Ctrl</kbd>+<kbd>PageUp</kbd> and <kbd>Ctrl</kbd>+<kbd>PageDown</kbd> switch dock tabs too);
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
