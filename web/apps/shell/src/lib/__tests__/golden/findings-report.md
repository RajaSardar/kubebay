# Kubebay findings report

- Cluster: `kind-dev`
- Generated: 2026-10-13T10:00:00.000Z
- Kubebay: v0.7.0
- Findings: 8 (3 high, 5 medium)

| Detector | High | Medium |
|---|---|---|
| Attack paths | 1 | 0 |
| RBAC | 1 | 0 |
| Upgrade readiness | 1 | 0 |
| Single points of failure | 0 | 1 |
| NetworkPolicy coverage | 0 | 1 |
| Secret exposure | 0 | 1 |
| ServiceAccount tokens | 0 | 1 |
| Image signatures | 0 | 1 |

## Attack paths

- **high** · Attack path to Deployment shop/api · `Deployment shop/api`
  Reachable from outside through LoadBalancer api-public → Its token can read Secrets in every namespace
  Controls: CIS 5.1.2 (Minimize access to secrets); ATT&CK T1552.007 (Unsecured Credentials: Container API)

## RBAC

- **high** · Bound to the built-in cluster-admin role · `ServiceAccount ci/deployer`
  ServiceAccount ci/deployer via ClusterRole:cluster-admin: cluster-admin can do anything in any namespace.
  Controls: CIS 5.1.1 (Ensure that the cluster-admin role is only used where required)

## Upgrade readiness

- **high** · PodDisruptionBudget policy/v1beta1 is removed in Kubernetes 1.25 · `cluster`
  This cluster still serves policy/v1beta1, 1 minor release before its removal. Move manifests to policy/v1.

## Single points of failure

- **medium** · One replica and no PodDisruptionBudget · `Deployment shop/api`
  Deployment shop/api: 1 replica and no PodDisruptionBudget

## NetworkPolicy coverage

- **medium** · No NetworkPolicy selects these pods · `App shop/api`
  2 pods of app api in shop: the namespace has no NetworkPolicy.
  Controls: CIS 5.3.2 (Ensure that all Namespaces have Network Policies defined)

## Secret exposure

- **medium** · Secrets read into environment variables · `App shop/api`
  2 pods of app api in shop read Secret db-creds into environment variables.
  Controls: CIS 5.4.1 (Prefer using Secrets as files over Secrets as environment variables)

## ServiceAccount tokens

- **medium** · Default ServiceAccount token mounted · `App shop/web`
  3 pods of app web in shop run as the default ServiceAccount with its API token mounted.
  Controls: CIS 5.1.5 (Ensure that default service accounts are not actively used); CIS 5.1.6 (Ensure that Service Account Tokens are only mounted where necessary); ATT&CK T1528 (Steal Application Access Token)

## Image signatures

- **medium** · Image signatures aren't enforced · `Namespace shop`
  Nothing enforces image signatures in namespace shop.
  Controls: CIS 5.5.1 (Configure Image Provenance using ImagePolicyWebhook admission controller); ATT&CK T1525 (Implant Internal Image)
