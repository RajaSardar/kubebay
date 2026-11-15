---
name: Do not use Claude as co-author in commits
description: Never add Co-Authored-By Claude lines in commit messages — use the user's personal git identity only
type: feedback
---

Do NOT add `Co-Authored-By: Claude ...` to commit messages. Use the user's personal git config identity only.

**Why:** User explicitly requested this — they want commits attributed to their personal user, not Claude.

**How to apply:** When committing, never append the Co-Authored-By trailer. Just write the commit message normally.
