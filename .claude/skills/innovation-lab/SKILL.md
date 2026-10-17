---
name: innovation-lab
description: Manage Kubebay's innovation/enterprise-feature backlog in .claude/memory/innovation_backlog.md — add new ideas, list/triage what's there, and hand a specific idea to the innovation-scout agent for scoping. Use when Raja mentions a new feature idea, asks "what's on the roadmap", or wants to prioritize/park something.
---

# Innovation Lab

This skill manages one file: `.claude/memory/innovation_backlog.md`. It is a backlog, not a task queue — nothing in it gets built just because it's listed. Read that file's own "How this file works" section first; it's the source of truth for status values and structure, this skill just describes how to *operate* on it.

## Adding a new idea

When Raja describes a new idea (or several in one message):

1. Read the current backlog file first — never blind-append without seeing what's already there. Check for near-duplicates; if the idea overlaps an existing entry, extend that entry instead of creating a new one.
2. Write each idea as its own `###` entry, in the same voice and level of detail as the existing entries: one paragraph grounding it in Kubebay's actual architecture (what already exists that it builds on, which files/packages it'd touch), not generic marketing copy. If you don't know the relevant part of the codebase, use Grep/Read to check before writing the entry — a wrong technical claim in the backlog is worse than a vague one.
3. Tag `[Enterprise]` only when it clearly needs a control plane beyond one laptop or is a guided-automation layer over a complex third-party controller (see the "Open-core split" section in the backlog file). Default to OSS when unsure — ask if the user seems to care about the split for this specific idea.
4. New entries start at `status: idea`. Never mark something `scoping`, `building`, or `shipped` yourself — those transitions come from actual work (an innovation-scout pass, an opened branch/PR, a merge), not from adding the idea.
5. Show the user the new entry text before or after writing it (a short confirmation, not the whole file dumped back).

## Listing / triaging

When asked what's pending, what's on the roadmap, or to prioritize:
- Read the file and summarize by status, most-actionable first (`scoping` > `idea` > `parked`), not by file order.
- For prioritization, reason about it out loud in 2-3 sentences (leverage vs. effort, what's OSS vs. Enterprise, what depends on what — e.g. cost-optimization and intelligent-VPA overlap) rather than mechanically re-sorting the file. Don't reorder the file's actual entries unless asked; status and a short "why" is enough.

## Scoping one idea

When the user wants a specific idea fleshed out ("scope the MCP server one", "what would it take to build #4"), don't do the deep-dive yourself inline — launch the `innovation-scout` agent with that one idea's full text as context (quote the entry, don't just say "idea #4", since agent numbering can drift as the file changes) and let it append the scoping spec to that entry and flip its status to `scoping`. Report back to the user once it's done; don't duplicate its analysis in your own reply beyond a one-line summary.

## Parking or dropping an idea

If the user says to drop or deprioritize something, set its status to `parked` and add a one-line reason inline (don't delete the entry — the backlog's value is remembering what was considered and why it was passed on).

## What this skill is not for

Never use this skill's flow to start actually implementing a feature. If the user says "build the KEDA wizard" rather than "add/scope the KEDA idea", that's a normal implementation task — follow the repo's usual small-validated-commits workflow (see `.claude/memory/feedback_commit_author.md` and the project state memory), not this skill.
