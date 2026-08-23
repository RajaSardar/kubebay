# Kubebay Security Model

> Security is a design input, not a review output. This document defines the model Phase 0 implements.
> Report vulnerabilities: open a private security advisory (GitHub) — see §8.

---

## 1. Threat Model (STRIDE-lite)

| Asset | Threat | Mitigation |
|---|---|---|
| kubeconfig credentials | Theft from memory/disk | Never log secrets; OS keychain for credential-helper tokens; no credential sync ever; engine holds creds in-process only |
| Engine localhost API | Another local process driving the engine ("confused deputy") | Binds `127.0.0.1` only + per-launch random session token required on every request/WS handshake; token never exposed via CLI args or env to child shells |
| Browser tab (web mode) | XSS → session theft | Strict CSP (no inline scripts, no `unsafe-eval`), `SameSite=Strict` cookies, short-lived sessions; WS origin-checked |
| In-cluster deployment | Privilege escalation past user's RBAC | **Impersonation**: engine authenticates users via OIDC then acts *as the user* (`Impersonate-User/Groups`) — cluster RBAC is the only authority; engine's own SA is minimal & audited |
| Logs/exec channels | SSRF / cross-cluster confusion | Channel requests pinned to cluster+namespace resolved server-side from subscription context; no arbitrary URL fetch from UI-originated params |
| YAML apply | Destructive accidental writes | Dry-run default, unified diff preview, typed confirmation for deletes/drain; every mutation recorded in local audit JSONL |
| AI features | Secret exfiltration to LLM providers | Read-only tools by default; **anonymization pass** (names/ns scrubbed) default-ON; provider allowlist; local-model mode for zero egress |
| Supply chain | Dependency/build compromise | Pinned toolchains, `govulncheck`+`npm audit` in CI, SBOM per release (syft), artifacts signed (cosign), provenance attestation |

## 2. Desktop App

- Tauri 2 capability allowlist: shell/renderer may do exactly what's declared — no blanket fs/shell access.
- Engine sidecar spawned with least privilege; communicates over loopback with session token.
- Auto-updates: signature-verified (Tauri updater + minisign keys held in GitHub protected environments).
- Crash reports: local-only unless user opts into sharing.

## 3. Web Modes

| Mode | Auth chain |
|---|---|
| Personal `kubebay serve` | Local session token printed on start; optional reverse-proxy auth left to operator (documented patterns) |
| In-cluster (Helm) | OIDC (any standard IdP) → verified JWT → impersonation headers → native RBAC; refresh handled by engine; logout revokes session |

The engine **never** makes authorization decisions itself: it proxies identity, K8s decides.
Consequence: Kubebay can't silently grant powers your RBAC doesn't — and the UI hides
actions denied by SSAR probes.

## 4. Secrets Handling in UI

- Secret values hidden by default; reveal requires click-and-hold or explicit toggle (no accidental shoulder-surfing).
- Redaction layer scrubs secret material from: log viewer copy-outs (opt-in setting), AI payloads (always), telemetry (always).
- No Secret values are ever written to audit logs — references only.

## 5. Plugins

- Backend plugins run as WASM (wazero): **no host access without declared capabilities**.
  - Capability grants: `cluster:read:<gvr-scope>`, `http:fetch:<host>`, `ui:*` — requested at install, shown in plain language, diffable on update.
- UI plugins: ES modules registering into typed slots; executed with same CSP as core; cannot fetch cross-origin except through capability-scoped proxy routes.
- Registry index is signed; install prompts show publisher + permission diff. Uninstall = full removal (no residue).

## 6. Telemetry & Privacy

- Default: **zero network calls** beyond the Kubernetes API servers in your kubeconfig and OS update checks you control.
- Opt-in metrics: anonymous counters (feature usage, crash-free rate) with a publicly documented payload schema and a settings page showing exactly what would be sent next.
- GDPR posture: opt-in before any collection; deletion = turn it off (nothing identifiable stored).

## 7. Secure Development Lifecycle

- Branch protection + required reviews on `engine/internal/{stream,httpapi,plugins}`.
- CI gates: SAST (gosec, semgrep), dependency audit, fuzz targets for protocol parsers (`go-fuzz`-style on delta/log frame decoding).
- Release checklist: SBOM + cosign signatures + provenance; reproducible builds goal for v1.0.

## 8. Reporting

Private vulnerability disclosure via GitHub Security Advisories ("Report a vulnerability").
Target triage SLA: 72 h acknowledgment, 30 d fix or documented mitigation. Credit reporters by default.
