# Kubebay — Claude Code Rules

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

## Build and Ship on Every Commit

**Before AND after every commit, run the build and tests. No exceptions.**

```
# Frontend
pnpm --filter @kubebay/shell exec vitest run
pnpm --filter @kubebay/shell build

# Backend (when engine code changes)
cd engine && go test ./...
```

- Run tests **before** committing — confirm green.
- Run build **before** committing — confirm no TypeScript/compilation errors.
- Never commit with a red build or failing tests.
- The build confirms the tests pass AND the compiler agrees. Both must be green.

---

## Commit Style

- No `Co-Authored-By: Claude` lines — ever.
- Use the user's git identity as-is.
- Conventional commits: `feat:`, `fix:`, `perf:`, `test:`, `refactor:`, `docs:`.

## Never Touch

- Default `~/.kube/config` — always use dedicated kind kubeconfigs for testing.
- Production EKS clusters.
