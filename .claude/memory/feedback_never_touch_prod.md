---
name: Never touch production clusters
description: CRITICAL — never run kubectl, tests, or any commands against production Kubernetes clusters; always use dedicated kind kubeconfigs
type: feedback
---

NEVER touch production Kubernetes clusters. Always use dedicated kind cluster kubeconfigs for testing.

**Why:** The user explicitly requires that production clusters are never used for testing or development. `~/.kube/config` default context points to production EKS — it must never be used directly.

**How to apply:**
- NEVER run `kubectl` without first verifying the context is a kind/dev cluster
- NEVER run integration tests without `KUBECONFIG=~/.kubebay/kubeconfigs/kind-test.yaml` (or equivalent dedicated kind kubeconfig)
- NEVER use `~/.kube/config` directly — its default context points to PRODUCTION EKS
- Before any cluster-touching command, print and verify the context name — it must contain "kind" or "kubebay-dev"
- NEVER run broad grep-then-delete patterns against any cluster
- When in doubt, do NOT run the command — ask the user first
