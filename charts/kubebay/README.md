# Kubebay Helm chart

Runs Kubebay in a cluster as a shared team dashboard. Without OIDC it uses the engine's own identity, so only use that for evaluation. With OIDC (`oidc.*` values), every user signs in through your identity provider, and every API call impersonates them.

```bash
helm install kubebay charts/kubebay --set ingress.enabled=true --set ingress.host=kubebay.corp.com
```

See `values.yaml` for OIDC, TLS, ingress and resource options.

## Verify the image

The image `ghcr.io/rajasardar/kubebay` is signed keylessly with cosign by the repository's `publish` workflow, and has a GitHub build-provenance attestation. Check a tag (or, better, the digest you deploy) before installing:

```bash
cosign verify ghcr.io/rajasardar/kubebay:v0.7.0 \
  --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/publish\.yml@refs/(heads/main|tags/v.+)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify oci://ghcr.io/rajasardar/kubebay:v0.7.0 --repo RajaSardar/kubebay
```

To enforce it, give Kyverno or Sigstore policy-controller the same identity, for example a Kyverno `verifyImages` keyless attestor with that subject regexp and issuer. Once it runs, Kubebay's own "Running image signatures" check on the RBAC page shows the image as verified against that policy.

## Security

- **Impersonation only with OIDC.** The engine needs the right to impersonate users and groups
  only to act as the signed-in user, so the chart creates that ClusterRole and its binding only
  when `oidc.issuerUrl` is set. Without OIDC the engine uses its own service account and has no
  impersonation rights.
- **Narrow it.** Impersonation is unrestricted by default, which means the engine could act as
  any group, `system:masters` included. Set `impersonation.groups` (and `impersonation.users`)
  to the names your IdP issues, and anything else is refused by the API server:

  ```yaml
  impersonation:
    groups: [platform-team, developers]
  ```
- **A locked-down pod.** It runs as non-root with the runtime's default seccomp profile, no
  privilege escalation, every Linux capability dropped and a read-only root filesystem. Settings
  and the audit log are written to a 64Mi `emptyDir` mounted at `/tmp`, so they do not survive a
  restart. There is no persistent volume option yet.
- **Shared settings come from values.** The app's Settings page can't change what applies to every
  user: `nodeShellImage` (the privileged node-shell pod), `debugImage`, and `prometheus.url`. With
  OIDC, users can query `prometheus.url` only once you set `prometheus.allUsers: true`, since it
  answers for every namespace whatever their RBAC; until then their queries go through the API
  server's service proxy as them.
- The in-cluster deployment already turns off the local shell, MCP, AI triage, extensions, cloud
  discovery and the cloud audit feed.

