# ADR 0001: Business model and licence

- **Status:** Proposed (2026-10-17). It's Raja's decision. This draft follows the recommendation in `docs/COMPETITIVE_ANALYSIS.md` and KB-01.
- **Date:** 2026-10-17
- **Backlog:** KB-01. It gates KB-17 step 2 (opt-in usage signal) and KB-20 (team edition).

## Context

Three documents in this repository disagree about how Kubebay makes money:

| Document | What it says |
|---|---|
| PRD §3 (non-goals) | *"No feature paywalls. Donations/sponsorships only."* and *"No accounts, no hosted control plane, no SaaS tier."* PRD §7: SaaS *"Rejected permanently."* |
| Innovation backlog, "Open-core split" | A *working assumption*: Enterprise candidates are (a) anything needing a control plane beyond one laptop (fleet policy, SSO, central audit export), and (b) guided automation over KEDA, Karpenter or VPA. |
| RESEARCH.md §8.4 | *"Open core + SaaS control plane is the correct path"*: monetise a hosted sync service. §10.3 suggests moving to AGPL-3.0. |

Users read this kind of ambiguity as a bait-and-switch risk. That is the wound Lens carries: Lens Desktop moved to a subscription licence and requires a Lens ID sign-in on every plan, the free one included, and that is the most repeated complaint in its community. It's also the reason Freelens's "no sign-in" pitch works. Retroactive changes to licence or pricing are what users don't forgive.

The facts this decision rests on:

- **What has shipped, all free, all single-user:**
  - the resource tables and drawers;
  - every detector (SPOF, NetworkPolicy, attack paths, RBAC, upgrade readiness);
  - the KEDA, Karpenter and right-sizing wizards (carve-out (b) above);
  - MCP;
  - BYO-key AI triage;
  - the air-gapped bundle;
  - the in-cluster Helm chart with OIDC.
- **Licences of comparable tools** (`website/src/data/comparison.ts`, each with its source):
  - Freelens: MIT;
  - k9s and Headlamp: Apache-2.0;
  - Lens Desktop: proprietary.
- **Kubebay is MIT today** (`LICENSE`) and has no CLA.

## Decision (proposed)

### (a) What stays free forever

Everything a single person uses, on a laptop or in their own cluster. That includes:

- every feature that has shipped or is planned for one user;
- the desktop app on every platform;
- the self-hosted web mode;
- the in-cluster chart with OIDC and impersonation;
- MCP;
- AI triage with your own key;
- the air-gapped bundle;
- every detector, wizard and integration.

No account, no sign-in, no licence key and no feature limit, ever. A feature that is free today is never moved behind payment.

### (b) A paid edition: only a self-hosted team edition, and only on demand

The only paid surface Kubebay may ever have is a **self-hosted, licence-keyed team edition** (KB-20). It holds only capabilities that exist *because* several people share one deployment:

- SSO group → feature policy;
- central audit export;
- shared saved views;
- a hub mode across team members' clusters.

The rules for it:

- **Never single-user features.** A licence key never gates a feature a single user has.
- **Self-hosted.** The customer runs it in their own cluster. Kubebay holds no customer's kubeconfigs or data.
- **Built only on demand.** It's built only when at least three organisations ask for it (KB-20's gate). Until then it doesn't exist.
- **Separate code.** Its code lives outside the MIT core, and the core never depends on it.

Carve-out (b) from the innovation backlog, guided automation over third-party controllers, is **dropped**. Those wizards shipped free and are single-user.

### (c) SaaS: no

No hosted control plane, no hosted sync, no hosted accounts. This confirms PRD §3 and §7, and rejects RESEARCH §8.4's "SaaS control plane". The reason is trust (PRD principle #1): holding users' kubeconfigs in a hosted service is a breach liability, and it is the failure mode Lens demonstrated. Team sharing is served by self-hosted in-cluster mode.

### (d) Licence: stay on MIT

AGPL-3.0 (RESEARCH §10.3) is rejected:

- **No SaaS is planned,** so AGPL's network clause protects nothing Kubebay sells.
- **It deters adoption.** Many companies' policies forbid AGPL tools outright, and Kubebay is a client tool that engineers install on their laptops.
- **It doesn't close a real gap.** A fork that adds sign-in or a paywall loses to Kubebay on Kubebay's own pitch. AGPL wouldn't prevent the fork, only its closed parts.
- **It breaks with the neighbours.** The comparable open-source tools are MIT (Freelens) or Apache-2.0 (k9s, Headlamp).
- **Relicensing later is the change users punish.** RESEARCH §10.3 itself says to decide before v1.0. This ADR decides: MIT.

A team edition on an MIT core needs no CLA, because MIT allows a separately licensed product to build on it. Contributions to this repository stay MIT, inbound equals outbound.

### (e) Sponsorship

- **GitHub Sponsors is the channel.** `.github/FUNDING.yml` already points at it.
- **Action for Raja:** confirm the Sponsors profile is live, then link it from the README and the website.
- **What sponsorship buys:** nothing in the product, so there are no sponsor-only builds or features. It funds the maintainer's time and the macOS Developer ID ($99/yr, KB-03).

## Options considered

1. **Donations only, no paid edition ever** (PRD §3 as written). It's the simplest promise, but it rules out ever funding team features that solo users don't need. That leaves enterprise requests unanswerable, or answered by a fork.
2. **Open core with a self-hosted team edition (proposed).** The PRD's promise holds for every individual. The one paid carve-out is narrow, self-hosted, demand-gated and stated now, so it can never surprise anyone.
3. **Open core plus SaaS** (RESEARCH §8.4). It's the most revenue-shaped option, but it contradicts PRD §3 and principle #1. It needs accounts and holds kubeconfigs, which is the exact thing Kubebay positions against.

## Consequences

These edits are made when the ADR is accepted, not while it's proposed: until then the PRD, RESEARCH, the innovation backlog and the website keep their current wording, so nothing announces a change that hasn't been decided.

- **PRD §3 changes in wording, not in intent:**
  - "No feature paywalls" becomes "no paywall on any single-user feature, ever".
  - It points here for the team-edition exception.
  - PRD §7's SaaS row stands.
- **The other documents point here:**
  - RESEARCH §8.4 and §10.3 point here instead of recommending SaaS and AGPL.
  - The innovation backlog's "Open-core split" points here, without carve-out (b).
  - The innovation-lab skill and the innovation-scout agent read that section, so their OSS-vs-Enterprise calls follow this ADR.
- **The backlog items it gates:**
  - **KB-20** may be built once three organisations ask, under the rules in (b).
  - **KB-17 step 2** (opt-in usage signal) is unblocked as far as the business model goes. It stays off by default, as PRD §3 requires.
- **Public copy:** the website's "Free, no paid tier" stays true until a team edition exists. Its PRD note ("No feature paywalls. Donations/sponsorships only.") changes to quote the new PRD §3 line. If one ships, the pricing copy says exactly what (b) says: free for every individual, paid only for the self-hosted team features.
