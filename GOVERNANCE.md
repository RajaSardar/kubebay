# Kubebay Governance

This document describes how Kubebay is run. It is intentionally simple — the project is early-stage and operated as a BDFL model. Transparency is the goal, not process.

---

## Project Lead

**Raja Sardar** is the project lead (BDFL — Benevolent Dictator For Life).

That means: final say on all technical decisions, product direction, API design, and what goes into a release. This is not a committee. If a discussion stalls, I decide and document the reasoning.

This is published openly because contributors deserve to know what they are signing up for before investing time.

---

## Contributor Tiers

There are three tiers. Advancement is based on contribution history and judgment, not seniority or tenure.

### Contributors
Anyone who has had at least one PR merged. You are listed in the project's contributor graph and acknowledged in release notes. No special permissions.

### Triagers
GitHub Triage role. Can label, close, and comment on issues and PRs. Cannot merge.

**How to earn it:** three merged PRs of reasonable scope (not typo fixes). Open a GitHub Discussion and ping me — I will grant it within a few days.

### Maintainers
Commit rights. Can merge PRs in their area of expertise. Cannot unilaterally change architecture, the roadmap, or release cadence without my agreement.

**How to earn it:** five non-trivial merged PRs AND active participation in Discussions for 90+ days. The bar is judgment and availability, not just code. I will reach out proactively when someone hits this threshold; you do not need to ask.

---

## Decision Making

Most decisions happen in PR review or GitHub Discussions, openly.

Rules:
- **Bug fixes and small improvements:** PR + CI passing is enough. No prior issue required.
- **New features:** open an issue first, describe the problem and approach, wait for feedback before writing code. This saves everyone time.
- **Breaking changes** (API, protocol, config schema, significant UX): must have an issue discussion before a PR is opened. I will label it `breaking-change` and it will not be merged until I have explicitly approved the approach.
- **Architectural decisions:** documented as ADRs in `docs/adr/`. If you are proposing a significant architectural change, draft an ADR as part of the PR.

When in doubt: open an issue. Discussion is cheap; reverting merged code is not.

---

## Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct.html) v2.1. The full text is in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Reports go to me directly via GitHub's report mechanisms or the contact in my GitHub profile.

---

## Roadmap

The roadmap is in [docs/ROADMAP.md](docs/ROADMAP.md) and tracked via GitHub milestones and issues. You can vote, comment, and propose — I read all of it. Final prioritization is mine.

If something is important to you and it is not on the roadmap, make the case in a GitHub Discussion. The best argument wins, not the loudest voice.

---

## License

Currently MIT. I am evaluating whether AGPL-3.0 is a better fit before v1.0. Any license change will be announced in advance with a clear rationale and migration window.

---

## Revisit

This governance document will be reviewed when the project reaches **10 active contributors** (defined as 10 distinct people with merged PRs in the last 90 days). At that point, a Maintainers group may make more sense than a single BDFL.

*Last updated: 2025*
