# Multiple windows and profiles: can we, what blocks it, what should we build

> Backlog item 26. Researched 2026-11-17 against `main` at v0.7.4. Research only; nothing is built.
> Claims about other tools come from their public documentation as remembered and are **not re-verified** for this note. Claims about Kubebay come from reading the code (paths given).

## 1. The question

VS Code and Chrome let you open several windows and keep separate profiles. Should Kubebay? Two different wants hide in the request:

- **Multiple windows**: look at prod and staging side by side, or two clusters at once, in one app session.
- **Profiles**: separate sets of clusters, settings and credentials (for example "work" and "personal", or "customer A" and "customer B"), switched as a unit.

## 2. Short answer

**Windows are cheap and mostly already work in the web layer. Profiles are the expensive half.** Ship windows first (about 3 to 4 days), then profiles as one engine per profile with its own kubeconfig and state directory (about 2 weeks). Do not start with per-profile isolation of everything.

## 3. What others do

| Tool | Windows | Profiles | Notes |
|---|---|---|---|
| VS Code | New Window; each window opens its own folder or workspace, one shared main process. | Profiles bundle settings, extensions, keybindings and UI state; each window can use a different profile. | Profile = a directory of state plus an id remembered per workspace. |
| Chrome | Many windows from one browser process. | Each profile has its own user-data directory (cookies, history, extensions); a window belongs to one profile and profiles run at once. | Strong isolation by directory, one binary. |
| Lens / Freelens | A single main window; a cluster opens as a view inside it. No multi-window mode known for Freelens. | Lens has Lens ID and Spaces; Freelens: none found. | **Not verified**; see `docs/research/2026-11-12-lens-freelens/` for what was gathered. |
| k9s | One cluster per process; users run several terminals. `--context` and `--kubeconfig` per process. | The kubeconfig context is the unit. | The "profile" is just a kubeconfig. |

The pattern: a window is a view, a profile is a directory of state. Chrome and VS Code keep one binary and put the isolation in a data directory. For Kubebay the natural data directory is a kubeconfig plus the engine's per-user files.

## 4. What the code does today, and what blocks each want

### 4.1 One engine, one token (`desktop/src-tauri/src/main.rs`)

- Tauri starts one sidecar `kubebay-engine` and reads its token from `<config dir>/kubebay/session-token` (`token_file_path`, `read_session_token`). Address and token go into a `OnceLock` (`ENGINE_SESSION`), and the same token is injected into the page by `initialization_script`. `tauri.conf.json` declares `"windows": []`; the one window is built in code with the label hard-coded as `"main"`.
- **Blocker A:** the run handler kills the engine on `WindowEvent::Destroyed` of *any* window ("Window closed ... kill engine immediately"). With two windows, closing one would kill the engine under the other. It must become "last window closed".
- **Not a blocker:** the token handoff. `initialization_script` runs per webview, so a second `WebviewWindowBuilder` with the same init script and a new label gets the token for free. Windows can share one token and one engine.

### 4.2 The page's per-window state (`web/apps/shell/src/lib/cluster-store.ts`)

- The active cluster lives in `sessionStorage` (key `kubebay.activeCluster`), with `?cluster=` in the URL taking precedence. `sessionStorage` is per webview, so **a second window already has its own active cluster**. This is the right design for windows. The deliberate rule that a fresh launch shows the cluster picker stays.
- Everything else the shell remembers is `localStorage` under `kb.*` keys (favourites, sort, columns, theme, font, density, sidebar, cluster icons, last-visited route; about 18 non-test files read it). Every window is served from the same engine origin (`http://127.0.0.1:<port>/`), so **all windows share one `localStorage`**. For windows that is fine and mostly desirable (same theme and favourites). Two risks: (1) last-writer-wins on keys such as `kb.last*` and column sets when two windows change them; (2) a theme change in one window will not repaint the other until reload unless a `storage` event listener exists (**not checked**).
- For **profiles**, `localStorage` is the problem: one origin means one storage, so it cannot be isolated per profile unless the origin differs (a different port) or the keys are prefixed.

### 4.3 The engine (`engine/cmd/kubebay/main.go`, `engine/internal/clusters/manager.go`)

- Flags: `--addr` (default `127.0.0.1:9898`), `--kubeconfig` (precedence `KUBEBAY_KUBECONFIG` > flag > `KUBECONFIG` > `~/.kube/config`), `--token-file`. An engine is already parameterised by kubeconfig, address and token file, so **one engine per profile needs no engine redesign**, only a launcher that picks distinct values.
- Per-user engine state (settings, history, the port-forward registry from backlog 43, the search index, extensions) lives under the user config dir. Two engines on one dir would both write it. A profile needs a state-dir flag or env (**none found today**; the exact file list needs an audit, estimated at a few days).
- The port-forward registry is one list of local ports across clusters inside one engine. Two engines could collide on local ports and would need to partition ranges.

### 4.4 Security notes

- The token is a bearer secret for an engine that holds kubeconfig credentials. One token per engine keeps the blast radius per profile. Sharing one token across the windows of one engine is no weaker than today.
- A profile with its own kubeconfig must never fall back to `~/.kube/config`. The launcher must always pass `--kubeconfig` explicitly.

## 5. Options

### Option A: windows only, one engine, one profile

New Window (⌘N and a menu item) builds another webview on the same URL with the shared init script and a unique label; the engine dies when the last window closes. Each window picks its own cluster through `sessionStorage`.

- Pros: tiny, no new concepts, what users first expect.
- Cons: no isolation; every window sees the same kubeconfig; no "work vs personal".

### Option B: profile = one engine per profile (Chrome style)

A profile is `{name, kubeconfig path, state dir}` in a small registry. Each profile gets its own sidecar on its own port with its own token file; each window belongs to one profile.

- Pros: real isolation; no engine redesign; a crash in one profile cannot hit another; tokens are per profile; a different port gives a different origin, so `localStorage` is isolated per profile with no code change.
- Cons: N engines means N times the cache and index memory; settings such as theme are not shared across profiles; port-forward ranges need partitioning; `ENGINE_SESSION` and the updater become per-profile.

### Option C: profile = a filter inside one engine (VS Code workspace style)

One engine, one token. A profile is a named list of contexts plus settings; the shell filters the cluster picker and prefixes `localStorage` keys with the profile id.

- Pros: one engine, shared caches, one token handoff, cheap.
- Cons: isolation is cosmetic (one process holds every credential; one origin shares all storage), which defeats the "customer A vs customer B" case; key prefixing touches about 18 files and is easy to miss one; the engine's per-user state is still shared.

### Debate

- **A vs B.** For B: "windows alone solve side-by-side but not the real pain, which is not mixing credentials." For A: "most users want two clusters on screen; B costs a registry, a launcher, N engines and an updater rewrite for a want nobody has measured." Resolution: they are not exclusive. A is a strict prefix of B (a B window is an A window with a profile id). Build A first and let demand for isolation pull B.
- **B vs C.** For C: "N engines is heavy, and backlog 23 says the app already feels heavy." For B: "C's isolation is cosmetic; the thing a profile is for is exactly what C does not give." Counter: "B's memory can be bounded by starting a profile's engine lazily and stopping it when its last window closes." Resolution: take B with lazy start and stop. C is only acceptable as a label or grouping feature in the cluster picker, which is a separate small idea and not a profile.
- **Open challenge to B:** two profiles on two ports means the user sets the theme twice. Mitigation: copy a short list of appearance keys on first open of a profile and accept drift after that.

## 6. Recommendation and phased plan

Recommend **A now, then B with lazy engines**. Reject C as a profile model.

| Phase | What | Effort (estimated) |
|---|---|---|
| 1. Windows | Change the `Destroyed` handler to "last window closed"; New Window menu item and ⌘N; unique labels; reuse the init script; window title shows the active cluster; a `storage` event listener for theme, density and font so windows stay in step; update the user manual and the ⓘ help. Tests: Rust unit test for the "last window" decision; Vitest for the storage sync; a smoke check that two windows hold different active clusters. | 3 to 4 days |
| 2. Engine state dir | Add a state-dir flag or env to the engine and route every per-user file through it (audit first); confirm two engines run side by side. Go tests with temp dirs. | 3 to 5 days |
| 3. Profiles | Profile registry (name, kubeconfig, state dir) in the desktop app config; Profiles menu and New Window in Profile; per-profile engine started lazily with its own port and token file and stopped on last window; `ENGINE_SESSION` becomes a map keyed by profile; updater talks to the default profile's engine; partition port-forward local-port ranges; profile name and a colour badge in the title bar. | 8 to 10 days |
| 4. Polish | Import a profile from a kubeconfig file; appearance copy on first open; delete a profile (removes its state dir after confirmation). | 3 days |

## 7. Risks and open questions

- **Acting on the wrong profile or cluster.** Two similar-looking windows is how people delete the wrong thing. A visible cluster or profile name and colour belongs in phases 1 and 3, not as an extra.
- **Memory.** Each engine's cache and index; **not measured**. Measure one engine on a large cluster before committing to phase 3 (overlaps backlog 23).
- **Quit semantics and the updater.** Today closing the window quits the app. With several windows and engines, "Quit" versus "close window" needs a decision (the macOS convention keeps the app running, which also changes the sidecar lifecycle).
- **Fresh-launch rule.** A new window should either open on the cluster picker (current behaviour) or inherit the opener's cluster; pick one.
- **`kb.*` key audit** (which keys must be shared, which per profile) is part of phases 2 and 3; this note only counted the files.
