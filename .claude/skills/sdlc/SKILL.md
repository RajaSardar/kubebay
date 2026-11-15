---
name: sdlc
description: Claude AI-native SDLC playbook — enforces spec-first development, TDD, multi-agent debate, iterative refinement, and evals-based quality gates on every task in Kubebay. Invoke at the start of any non-trivial implementation, design, or debugging task.
---

# Claude AI-Driven SDLC

This skill enforces Anthropic's AI-native software development lifecycle on every task. It is not optional — apply it before implementing, designing, or debugging anything non-trivial.

---

## Lesson 1 — Spec First, Code Second

Before writing a single line of implementation:

1. Write a one-paragraph spec: what the feature does, what it does NOT do, and what "done" looks like.
2. Get explicit agreement on the spec before touching code.
3. If the spec is ambiguous, resolve ambiguity in the spec — not in the code.

**Red flag**: opening a file to "just start" before the spec is written.

---

## Lesson 2 — TDD Without Exception

See `CLAUDE.md` TDD rule. Recap:

1. Write a failing test that captures the expected behaviour.
2. Run it — confirm it fails for the right reason (not a syntax error, not a wrong import).
3. Write the minimum code to make it pass. No extras.
4. Refactor with green tests.

Every bug fix gets a regression test that reproduces the bug first. No exceptions for "simple" changes.

---

## Lesson 3 — Multi-Agent Debate Before Implementing

When a decision has multiple valid solutions (architecture, API shape, UI pattern):

1. Launch agents in parallel, each taking one perspective.
2. **Synthesis round is mandatory** — feed each agent's output to a synthesis pass that explicitly finds contradictions and cross-challenges assumptions.
3. Implement only from the final synthesised verdict, not from the first parallel run.

Parallel agents with no debate is a process violation.

---

## Lesson 4 — Iterative Refinement Over Big-Bang Commits

- Break every task into the smallest independently-shippable slice.
- Commit after each slice passes tests — not at the end of a large batch.
- Each commit should be a `feat:`, `fix:`, `refactor:`, `test:`, or `perf:` conventional commit with a single clear purpose.
- If a commit touches more than 3 unrelated concerns, split it.

---

## Lesson 5 — Prompt Chaining for Complex Tasks

When a task requires multiple reasoning steps (plan → implement → verify → ship):

- Chain steps explicitly: output of step N is input of step N+1.
- Never collapse a chain into one giant prompt — quality degrades.
- For Kubebay: Plan → Write test → Implement → Run test → Build → Ship.

---

## Lesson 6 — Extended Thinking for Architecture Decisions

For decisions that affect multiple packages or have long-lived consequences (data model changes, new API shapes, store design):

- Use extended thinking / multi-agent debate (Lesson 3) before deciding.
- Write the decision and its rationale as a comment or a memory entry — not just in a commit message where it gets buried.
- Revisit the decision after the first implementation slice; update if reality diverged from the plan.

---

## Lesson 7 — Evals as Quality Gates

Every non-trivial feature should have at least one eval that can be run automatically:

- **Go**: `go test ./...` must be green.
- **Frontend**: `pnpm --filter @kubebay/shell test` must be green.
- **End-to-end**: smoke-test the Mac app (`/Applications/Kubebay.app`) manually after each ship.
- **Contract**: if you add a new API endpoint, add at least one integration test that hits it.

Shipping without passing evals is a process violation.

---

## Lesson 8 — Token-Efficient Context Management

- Read only the files you need for the current slice — don't load the entire codebase.
- Use Grep/Glob to find the exact location before reading.
- When working across packages, read the interface/type first, then the implementation only if needed.
- Don't re-read files you already have in context unless checking for staleness.

---

## Lesson 9 — Security-First by Default

At every layer:

- Never interpolate user input into shell commands, SQL, or template strings without sanitisation.
- Secrets (kubeconfig, tokens) never appear in logs, state, or URLs.
- RBAC checks happen server-side (`engine/`), never trust the frontend alone.
- When in doubt, refuse the action and ask — don't silently degrade to a less-safe path.

---

## Lesson 10 — Ship, Observe, Iterate

After every commit that changes behaviour:

1. Run the full build and ship pipeline (see `CLAUDE.md` "Build and Ship Mac App").
2. Open `/Applications/Kubebay.app` and manually verify the change works end-to-end.
3. If something is wrong, fix it in the same session — don't defer to "next time".
4. Record any surprising findings as a memory entry or a comment in the relevant file.

---

## Applying This Skill

At the start of a task, run through this checklist:

- [ ] Spec written and agreed
- [ ] Failing test written and confirmed
- [ ] Smallest slice identified
- [ ] Multi-agent debate done (if decision has multiple valid paths)
- [ ] Evals (tests + build) gate defined
- [ ] Post-ship manual smoke-test planned

If any checkbox is unchecked and the task is non-trivial, stop and complete it before proceeding.
