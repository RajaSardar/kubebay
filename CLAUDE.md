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

---

## Commit Style

- No `Co-Authored-By: Claude` lines — ever.
- Use the user's git identity as-is.
- Conventional commits: `feat:`, `fix:`, `perf:`, `test:`, `refactor:`, `docs:`.

## Never Touch

- Default `~/.kube/config` — always use dedicated kind kubeconfigs for testing.
- Production EKS clusters.
