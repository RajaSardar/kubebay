# Kubebay Tech Stack

> Every choice lists the **alternatives considered** and the reason for rejection/deferral.
> Changes to this file require an ADR (Architecture Decision Record) in `docs/adr/`.

---

## 1. Summary Table

| Layer | Choice | Locked? |
|---|---|---|
| Engine language | Go 1.23+ | ✅ |
| K8s client | `client-go` (+ dynamic client, discovery, `k8s.io/metrics`) | ✅ |
| Streaming transport | WebSocket (nhooyr `websockets`) + MessagePack | ✅ |
| REST framework | `net/http` + `chi` router (stdlib-first) | ✅ |
| Helm integration | Helm SDK v3 (`helm.sh/helm/v3/pkg/action`) | ✅ |
| Plugin runtime | WASM via `wazero` (pure-Go interpreter/compiler) | ✅ Phase 3 |
| MCP server | Official Go MCP SDK (stdio + streamable HTTP) | ✅ Phase 3 |
| Frontend framework | React 18 + TypeScript 5 (strict) + Vite | ✅ |
| Data fetching | TanStack Query (REST) + custom topic stores (WS streams) | ✅ |
| Virtualization | TanStack Virtual (+ TanStack Table headless) | ✅ |
| State | Zustand (UI state) — no Redux/MobX | ✅ |
| Terminals | xterm.js (+ node-pty equivalent via engine PTY) | ✅ |
| YAML editor | Monaco (`@monaco-editor/react`) + K8s JSON schemas | ✅ |
| Design system | Tailwind CSS + Radix primitives, token-driven themes | ✅ |
| Charts | Recharts (simple) / visx (topology-adjacent custom) as needed | ✅ |
| Topology graph | `@xyflow/react` (React Flow) | ✅ |
| Desktop shell | Tauri 2 (engine as sidecar) — Electron = documented fallback | ✅ |
| Packaging | goreleaser (engine), Tauri bundler (desktop), Helm chart (in-cluster) | ✅ |
| E2E tests | Playwright against kind clusters | ✅ |
| Unit tests | Go testing + testify · Vitest | ✅ |
| Lint/format | golangci-lint · ESLint + Prettier · actionlint | ✅ |
| CI/CD | GitHub Actions; releases signed (cosign), SBOM (syft) | ✅ |

## 2. Decisions & Rationale

### 2.1 Engine: **Go** (not Rust, not Node.js)
- **client-go is the canonical client**: informer machinery (Reflector/DeltaFIFO/Indexer), metadata-only watches, WebSocket exec/port-forward, SSA support — all battle-tested by every controller in the ecosystem.
- **Helm SDK is Go-only.** Rust would require shelling out to helm CLI (fragile, slow); Node has no SDK either.
- Precedent: Headlamp, k9s, Radar, and every serious K8s backend chose Go for exactly these reasons.
- *Rust deferred*: kube-rs exists but its informer/cache layer is younger; revisit only if a concrete need arises.

### 2.2 Transport: **one multiplexed WebSocket** (not SSE, not gRPC-web, not many sockets)
- Browsers cap concurrent connections (~6); multiplexing all topics/channels over one socket is the proven Headlamp/k8s-view pattern.
- SSE can't carry exec stdin or port-forward bidirectional flows.
- gRPC-web adds proto toolchain complexity for little gain at UI scale; REST+WS keeps the surface hackable.
- **MessagePack** payloads for deltas/log chunks (binary, small, fast decode); **JSON control frames** stay debuggable with plain tools.

### 2.3 Frontend: **React + TS strict + Vite**
- Largest ecosystem for editor components (Monaco), terminals (xterm), virtualization (TanStack), graphs (xyflow).
- TS strict mode from day one; `@tanstack/*` family gives headless primitives without visual lock-in.
- *Svelte/Solid considered*: excellent perf stories, but component ecosystems above are React-native; not worth the port tax.
- **No MUI / no AntD**: Headlamp's "plain Material look" and Lens's dated styling are warnings; our differentiator includes a distinctive modern design system.

### 2.4 State: **topic stores + Zustand** (not Redux, not MobX)
- WS delta streams map naturally to per-subscription ordered maps with immutable snapshot swaps.
- Freelens's MobX + custom DI (`@ogre-tools/injectable`, 50 packages) is a cautionary tale of framework ceremony; we keep state boring and local.
- TanStack Query handles genuinely request/response data (REST) with caching/retry for free.

### 2.5 Desktop shell: **Tauri 2** (Electron fallback documented)
- Tauri: ~5–15 MB installer vs ~150–250 MB; ~60–120 MB RAM vs ~300–500 MB; sub-second cold start; capability-based security model aligns with SECURITY.md.
- Engine runs as a **sidecar binary** (Go cross-compiles cleanly into Tauri's external binaries mechanism).
- Known trade-off accepted: OS webview variance (WKWebView/WebView2/WebKitGTK). Mitigations: design system avoids bleeding-edge CSS; Playwright matrix on all three platforms in CI.
- **Fallback trigger:** if WebKitGTK (Linux) proves unmanageable in practice → Electron build target reuses the identical SPA + engine; architecture isolates this decision to the shell package only.

### 2.6 Plugins: **WASM (wazero)** for backend + typed React slots for UI
- WASM gives sandboxing, multi-language authoring, and capability-scoped imports (see SECURITY.md).
- UI extensions are standard ES modules registering into typed extension points (sidebar, detail tabs, table columns, actions) — familiar to web devs, no fork required.
- *Lens-style JS-in-main-process extensions rejected:* arbitrary host access is how extension ecosystems become malware vectors.

### 2.7 AI: **MCP server built-in; copilot BYO-model**
- Deterministic analyzers run keyless/offline (k8sgpt-style rules: CrashLoopBackOff, ImagePullBackOff, OOMKilled, probe failures, PVC issues…).
- LLM explanation is opt-in, provider-pluggable (OpenAI-compatible endpoints incl. local Ollama), anonymization toggle default-on, read-only by default.

## 3. Repository Layout

```
kubebay/
├── engine/                  # Go module
│   ├── cmd/kubebay/         # single binary: serve (web/in-cluster), version…
│   ├── internal/clusters/   # kubeconfig, discovery, health
│   ├── internal/informers/  # cache pool, subscriptions, broadcaster
│   ├── internal/stream/     # ws hub, logs/exec/pf channels
│   ├── internal/helm/       # helm actions wrapper
│   ├── internal/metrics/    # metrics-server + prom adapter
│   ├── internal/rbac/       # SSAR cache, role graph
│   ├── internal/timeline/   # event ring store
│   ├── internal/plugins/    # wazero host, capability grants
│   ├── internal/mcp/        # mcp server exposing read-only tools
│   └── internal/httpapi/    # REST handlers, auth middleware
├── proto/                   # protocol docs & codegen (TS types from Go)
├── web/                     # pnpm workspace
│   ├── apps/shell/          # the SPA
│   └── packages/ui/         # design system (tokens, components)
├── desktop/                 # Tauri 2 shell (sidecar config, updater)
├── charts/kubebay/          # in-cluster chart (OIDC, ingress, impersonation)
├── plugins/                 # example wasm + ui plugins
├── e2e/                     # playwright suites + kind fixtures
└── docs/                    # you are here
```

## 4. Version Support Policy

| Dimension | Support target |
|---|---|
| Kubernetes | N-2 minor versions (rolling); streaming falls back to SPDY below 1.31 |
| macOS | 12+ (universal: arm64 + amd64) |
| Windows | 10/11 (x64, arm64 best-effort) |
| Linux | glibc distros via deb/rpm/AppImage; engine also ships static musl binary |
| Node (build-time only) | LTS ≥ 20 |
