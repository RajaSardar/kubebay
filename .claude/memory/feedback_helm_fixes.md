---
name: Helm Kubebay integration fixes
description: Error message transparency and missing API route for helm upgrade/install
type: feedback
---

Two Helm issues were fixed:

**Issue 1: Generic error message**
The "Failed to list releases — is the cluster reachable?" message was masking the actual Helm SDK error (RBAC issues, kubeconfig auth problems, exec plugin auth failure).

Fix: Show `releases.error?.message` in the UI + add a Retry button so users can debug the real issue. Helm SDK auth path is separate from k8s client auth, so errors can happen even when other cluster access works.

Why: Helm SDK init (`cfg.Init`) can fail for reasons invisible to the main k8s client — kubeconfig exec plugins, service account permissions, API server TLS. The actual error is the diagnostic tool.

**Issue 2: Missing /api/helm/upgrade route**
The handler `HelmManager.HandleUpgrade` was implemented in `helm.go` but never registered in `server.go` routes. This caused Helm chart install/upgrade operations to return 404.

Fix: Added `r.Post("/api/helm/upgrade", d.Helm.HandleUpgrade)` to server.go line 355.

Why: Helm release management (upgrade, install) flow in frontend was failing silently because the backend endpoint didn't exist, even though the implementation was complete.

**How to apply**:
- Always show actual error messages from 3rd-party SDKs (Helm, Prometheus, etc.) instead of generic fallbacks
- When adding new handler functions, verify the route registration in server.go exists
