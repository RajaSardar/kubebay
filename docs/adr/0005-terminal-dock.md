# ADR 0005: The terminal lives in a dock

- **Status:** Accepted (2026-11-04). Backlog #6 asked to see where Freelens keeps its terminal and to debate it with 20 experts. Twenty experts answered independently: innovators, frontend, engine and interaction designers, a CEO, a CTO, a planner, two lazy engineers, two Kubernetes experts, two on-call engineers, four hourly users, and accessibility and performance specialists. Four coalitions then cross-challenged each other: minimalists, operators, safety and cost, and product. A judge checked their claims against the code and ruled, overruling each coalition at least once.
- **Date:** 2026-11-04
- **Implemented by:** the dock (v1, this ADR's PR). Later slices are listed below.

## Context

Raja's backlog #6: "Terminal tool in the kubebay acting as a side nav, see freelens space where they are keeping this".

Today the local shell is a page, `/terminal`. Leaving the page unmounts it, and unmounting `useChannelTerm` closes the channel and disposes the terminal (`useChannelTerm.ts:204–212`). Go to Pods to look something up, come back, and the shell is gone along with its scrollback.

Freelens keeps its terminal in a **dock** at the bottom of the cluster view. Its sessions live in a store keyed by tab id, not in components, so navigating or minimising only detaches the view. The same dock holds pod logs and create, edit and Helm editors. Its rough edges are:
- Ctrl+W/⌘W closes a tab while you type;
- a disconnected tab both offers Restart and closes itself;
- the heights are hardcoded.

What the debate found in Kubebay's code underneath:
- **Collapse resizes the shell.** On a hidden host, `fit()` bails and `geometry()` falls back to 80×24 (`useChannelTerm.ts:137–145`). The ResizeObserver sends that size, so collapsing any panel would resize the live program.
- **The page shell itself unmounts.** `AppInner` unmounts on `/clusters` and on remote disconnects (`App.tsx:448`, `useRemoteDisconnects.ts:28`). A shell owned by a component anywhere in it dies there too.
- **A second extension command is lost.** The prefill is read once in a `useState` initialiser (`LocalShellTerm.tsx:126`), so a second extension command is dropped.
- **Restart isn't armed, even on production.**
- **Keystrokes typed during a disconnect run later.** `ws.ts` queues keystrokes and chan-opens while disconnected and flushes them on reconnect. A command typed into a dead shell would run in a new one.
- **Keys:**
  - xterm cancels every key it translates. Ctrl+` and Ctrl/⌘+Shift+S still bubble to `window`.
  - The drawer's split chord has no typing guard.
  - Enter with any modifier sends CR, so ⌘⇧Enter both runs the line and acts in the drawer.
- **Drawers would close on the dock.** A drawer is `fixed; top:0; bottom:0`, and any press outside it closes it (#15), so a press in a dock would too.
- **xterm's place in the bundle is unguarded.** xterm stays out of the main chunk only because the terminal page is lazy, and no test checks it.

## Decision

1. **A bottom dock in the content column**, between the page and the status bar. The sidebar and cluster strip keep their full height. Raja's "side nav" is read as "a panel beside the app, not a page", which is what Freelens does. A right-hand panel was rejected: drawers already open on the right.
2. **v1 is today's single bound local shell, made to survive navigation.** It has no tabs and no other kinds, and needs no engine change.
3. **One module-level session object owns the xterm and its channel.** It is neither a component nor a tab store. The dock view only attaches and detaches it, behind its own error boundary. A component-owned shell would die on `/clusters` and on remote disconnects, and the status bar and the prefill path both need the binding.
4. **Closing the dock detaches the terminal without resizing or ending it.** A host with no width or height is never fitted or resized.
   - The session ends only on **End shell**, `exit`, **Restart**, a dropped socket or the armed "Open a shell on X".
   - While the socket is down, keystrokes queue nothing.
5. **Ctrl+` toggles the dock from anywhere, including from inside the shell.** It matches `code === "Backquote"`, Ctrl only, on every OS:
   - closed: opens the dock and focuses the shell;
   - open with focus elsewhere: focuses the shell;
   - focus in the shell: closes the dock and returns focus where it was.
   - Nothing else ever focuses the shell.
6. **Entry points:**
   - **Status bar:** a **Terminal** toggle with its key, showing the bound context and a "production" pill while a shell is live.
   - **Sidebar:** Tools → Terminal opens the dock and doesn't navigate.
   - **`/terminal`:** opens the dock and returns to where you were.
7. **Production safety carries over and tightens.**
   - The binding, the armed first open and the stale banner work as today.
   - **Restart** is armed on a production-looking context.
   - The context and a production pill sit in the dock header and the status bar. They replace the two always-on banners.
8. **A command from an extension is never typed into a live shell.**
   - With no shell, it opens one on its cluster (armed on production) and types the command once, without Enter or focus.
   - With a live shell, a banner offers **Copy** and either **Type into this shell** (same cluster) or the armed "Open a shell on X" (another cluster).
   - A newer command replaces a pending one.
9. **Drawers end above the open dock and ignore presses in it**, through a `@kubebay/ui` prop. Presses on the page still close them (#15).
10. **A `@kubebay/ui` `Splitter` sets the height.**
    - It has the `separator` role; the arrow keys move it 16 px and a double-click resets it.
    - Default min(300 px, 35% of the window); minimum 120 px; maximum the window less 240 px.
    - The height is kept on this machine. The open state and the session are not: a relaunch starts closed, with no terminal built and nothing sent.
11. **Without a local shell** (standalone, in-cluster, OIDC), the toggle is hidden and other entry points say "This engine build has no local shell." No xterm is loaded.
12. **No `@xterm/xterm` import reaches the main chunk**, held by an import-graph test.

## Later slices

Each ships alone, behind its gate:
1. **Node-shell reaper** (engine). The engine deletes the pod on timeout and when the exec closes, sets `activeDeadlineSeconds`, sweeps at startup and audits creation. *Gate:* on kind, closing the drawer, a timeout and `kill -9` each leave no pod.
2. **Confirm before closing the window with live shells.** *Gate:* proof that Tauri can intercept `CloseRequested`.
3. **Engine hardening.** A channel cap, exec stdin through a queue rather than the read loop, channel ids in audit records, and a frame when the session's context drifts. *Gate:* Go tests show a stalled exec doesn't block watches.
4. **Local-shell tabs**, each with its own label, production pill, stale marker and arming. *Gate:* slice 3, open channels equal open tabs, a measured RSS budget, and a week of Raja using it.
5. **Pod logs in the dock**, reopened with the tail, Previous and a "pod gone" state. *Gate:* slice 4.
6. **Open in dock** for a pod's Terminal, handing over the one audited exec. *Gate:* slices 3 and 4.
7. **Node shell in the dock.** *Gate:* slices 1 and 6.
8. **"Run in terminal"**, and k9s's `s` and `l` keys, on the prefill contract (8). *Gate:* slice 4.
9. **AI proposals** over MCP on the same contract. No ghost text, and no scrollback sent to a model by default. *Gate:* slice 8 and a security review.

## Rejected

- A right-hand side nav.
- Following the cluster picker.
- Reopening shells automatically.
- Resuming or replaying sessions in the engine.
- Create, edit and Helm tabs.
- A fullscreen overlay.
- ⌘W to close: in the desktop app it closes the window and the engine with it.
- Broadcasting input to several shells.
- AI ghost text.
- Debug containers on "+".
- Two fixed heights instead of a splitter: keyboard resizing is an accessibility need.
- Ctrl+K, F6 or ⌘J as the toggle. Ctrl+K belongs to the shell, xterm swallows F6, and ⌘J is a line feed off macOS.
