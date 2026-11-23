# ADR 0006: Licence — fair source (FSL-1.1-MIT)

- **Status:** Accepted (2026-11-24). Proposed 2026-11-19; in effect from v0.8.0.
- **Date:** 2026-11-19
- **Supersedes:** section (d) "Licence: stay on MIT" of [ADR 0001](0001-business-model-and-licence.md). The rest of ADR 0001 is unchanged by this record.
- **Backlog:** KB-01 (d).

## Context

Kubebay has been MIT since its first release. MIT lets anyone take the code, rename it and sell it, or host it as a paid service, without giving anything back. The goal for the licence is narrower than MIT and wider than the noncommercial licences:

- **Anyone can use it free,** individuals and companies alike, at work included.
- **The source stays public,** and people can read, change, build and share it.
- **Nobody can resell it** in any form: as a rebranded app, bundled into a paid product, or hosted as a paid service.

## Decision

From **v0.8.0**, Kubebay is licensed under the **Functional Source License, Version 1.1, MIT Future License** (`FSL-1.1-MIT`), unmodified, as published by Sentry at <https://fsl.software>.

- **Permitted:** any purpose other than a *Competing Use*. The licence names internal use, non-commercial education and research, and professional services to a licensee as permitted.
- **Not permitted:** making the software available to others in a commercial product or service that substitutes for it, or offers the same or substantially similar functionality.
- **Future licence:** each release becomes available under MIT on the second anniversary of the day it was made available. That grant is irrevocable.
- **Earlier releases:** v0.7.10 and every release before it stay MIT. A licence attaches to the release it ships with, and the change can't and doesn't take that back.
- **Contributions:** contributors agree to the terms in `CONTRIBUTING.md` § Licensing, which let the maintainer relicense contributions. All 102 non-bot commits before this change are the maintainer's own, so no past contributor's consent is needed.

## Options considered

| Option | Why not |
|---|---|
| **Stay on MIT** | Doesn't prevent resale, which is the goal. |
| **AGPL-3.0** | Open source, and it doesn't prevent selling. It only forces sharing changes. Many companies forbid AGPL tools, so it also costs adoption. |
| **Elastic License 2.0** | Prohibits hosting it as a managed service and getting around licence keys, but doesn't clearly stop selling a rebranded desktop build. |
| **PolyForm Shield 1.0.0** | Close to this goal, but never becomes open source, so it asks for more trust from users. |
| **PolyForm Noncommercial 1.0.0** | Forbids all commercial use, so engineers couldn't use Kubebay at work. That defeats a developer tool. |
| **Business Source License 1.1** | Similar effect, but each project writes its own "Additional Use Grant" and change date, which users have to read and interpret. FSL fixes those choices in a standard text. |

## Consequences

- **"Open source" is no longer accurate.** FSL isn't an OSI-approved licence. Public copy says "free to use" and "fair source" or "source in the open", and names the licence, rather than "open source".
- **Trust has to be earned again.** README principle 7, ADR 0001 (d) and the website promised MIT. The change is announced before v0.8.0 ships, as GOVERNANCE.md promises, with this rationale, and the free-to-use promise for every individual and company stands.
- **Listings that require an OSI licence** may no longer accept Kubebay. Check each one (`docs/launch/`) before submitting.
- **Files changed with this decision:** `LICENSE`, `README.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, `package.json`, the website's licence copy and structured data, the comparison table's licence row, and the docs home page.
