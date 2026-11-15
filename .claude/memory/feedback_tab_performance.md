---
name: Tab re-render performance fix
description: Module-level WebSocket stream cache prevents loading skeleton flash when navigating between tabs
type: feedback
---

When switching ResourceTable tabs (Pods → Deployments → Pods), the component unmounts and remounts, which used to trigger a full WebSocket re-subscription and loading skeleton flash. This felt slow even though data arrived within 100-500ms.

**The fix**: Module-level `streamCache.ts` that stores Map entries (with server-assigned keys preserved) keyed by `cluster|gvr|ns|labelSelector|mode`. On remount, `useResourceStream` pre-populates from cache so `synced=true` with rows showing immediately, then the subscription re-establishes in the background.

**Why no display:none?** Considered hiding inactive route components with CSS to keep them mounted, but rejected — xterm.js terminals (ExecTerm) use ResizeObserver which stops firing on hidden elements, breaking terminal functionality.

**How to apply**: This is the correct approach for instant tab navigation without UX regressions. The cache:
- Survives React unmount/remount (module-level Map)
- Has 5-minute TTL (stale data protection)
- Clears on cluster switch (multi-cluster safety)
- Preserves exact Map entry keys for delta op correctness

Apply this pattern to any WebSocket-backed streaming data, not just ResourceTable.
