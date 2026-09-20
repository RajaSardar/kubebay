# Kubebay — Claude Code Rules

## ALWAYS-ON SKILL: Claude AI-Driven SDLC

**Every non-trivial task MUST follow the AI-native SDLC playbook at `.claude/skills/sdlc/SKILL.md`.**

Invoke it at the start of any implementation, design, or debugging task. The checklist in that skill (spec → failing test → smallest slice → debate → evals → ship) is the minimum bar for every piece of work in this repo.

---

## PRIMARY RULE: Test-Driven Development

**Write the test first. Always. No exceptions.**

Before writing any implementation code:
1. Write a failing test that describes the expected behaviour.
2. Run it — confirm it fails for the right reason.
3. Write the minimum code to make it pass.
4. Refactor if needed, keeping tests green.

This applies to:
- Every new Go function or handler (`engine/`)
- Every new React hook, utility, or component (`web/`)
- Every bug fix — add a regression test that reproduces the bug before fixing it

### Go tests

```
cd engine && go test ./...
```

Test files live alongside the code they test (`foo_test.go` next to `foo.go`).
Use `httptest.NewRecorder` for HTTP handlers, real in-process servers for integration tests.
Do **not** mock the Kubernetes client unless testing something that explicitly cannot hit a real cluster — use `envtest` or a live kind cluster instead.

### Frontend tests

```
pnpm --filter @kubebay/shell test
```

Use Vitest + `@testing-library/react`. Test hooks with `renderHook`. Test components by behaviour (what the user sees), not implementation (internal state).

### CI gate

No PR merges if `go test ./...` or `pnpm test` is red. Tests are not optional.

### Zero-tolerance enforcement

**TDD is not a suggestion.** If you find yourself writing implementation code before a failing test exists, stop immediately, write the test first, confirm it fails, then proceed. There is no exception for "simple" changes, "quick" fixes, or "obvious" code. Every. Single. Time.

---

## Multi-Agent Debate Rule

**When multiple expert agents are launched for analysis, they MUST debate each other — not just run in parallel.**

Parallel independent agents are NOT a debate. A debate requires:
1. Each agent posts its findings/verdict.
2. A synthesis round where agents explicitly cross-challenge each other's conclusions — identify contradictions, stress-test assumptions, and sharpen verdicts.
3. A final consolidated verdict emerges from the cross-challenge, not from the first parallel run.

If you launch agents for design review, architecture decisions, or feature analysis:
- Run the agents
- Feed each agent's output to a synthesis agent (or round) that must find at least one disagreement or refinement
- Only implement from the final synthesised verdict

Skipping the debate round and implementing directly from parallel-agent outputs is a process violation.

---

## Build and Ship the Mac App on Every Commit

**After every commit, build and ship the full macOS desktop app. No exceptions.**

Full build + ship sequence:

```bash
# 1. Tests first (TDD gate)
pnpm --filter @kubebay/shell exec vitest run
cd engine && go test ./...

# 2. Build web frontend + embed into engine binary
make build

# 3. Copy engine binary into Tauri sidecar slot
cp engine/bin/kubebay desktop/src-tauri/binaries/kubebay-engine-aarch64-apple-darwin

# 4. Build the macOS .app (MUST use full tauri build — --no-bundle does NOT update the .app bundle)
cd desktop && pnpm tauri build

# 5. Ship — copy to /Applications so it's immediately runnable
cp -R desktop/src-tauri/target/release/bundle/macos/Kubebay.app /Applications/Kubebay.app
```

- Never commit without running this full sequence.
- "Ship" means copying the fresh `.app` to `/Applications` — the user runs the updated build immediately.
- NEVER use `--no-bundle` — it only builds the Rust binary and does NOT update the .app bundle in target/release/bundle/macos/. Every ship using `--no-bundle` silently installs stale binaries.

### Mandatory Post-Ship Visual Testing

**After every ship, take a screenshot of the running app and smoke-test it. No exceptions.**

```bash
# 1. Activate and screenshot the app
osascript -e 'tell application "Kubebay" to activate'
sleep 1
screencapture -x /tmp/kubebay-post-ship.png
open /tmp/kubebay-post-ship.png
```

Minimum checks on every ship:
- App launches to the correct page (not stuck on cluster picker)
- No stuck skeletons / loading spinners after 3 seconds
- Content is visible — pods/nodes/data rendered, not blank
- No JavaScript error banners or white screens
- Navigation between tabs works without content vanishing

If any check fails: **do not commit**. Fix the visual regression first, then re-ship and re-check.

---

## Commit Style

- No `Co-Authored-By: Claude` lines — ever.
- Use the user's git identity as-is.
- Conventional commits: `feat:`, `fix:`, `perf:`, `test:`, `refactor:`, `docs:`.

## Never Touch

- Default `~/.kube/config` — always use dedicated kind kubeconfigs for testing.
- Production EKS clusters.
