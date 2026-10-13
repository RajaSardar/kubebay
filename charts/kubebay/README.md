# Kubebay Helm chart

Runs Kubebay in a cluster as a shared team dashboard. Without OIDC it uses the engine's own identity, so only use that for evaluation. With OIDC (`oidc.*` values), every user signs in through your identity provider, and every API call impersonates them.

```bash
helm install kubebay charts/kubebay --set ingress.enabled=true --set ingress.host=kubebay.corp.com
```

See `values.yaml` for OIDC, TLS, ingress and resource options.

## Verify the image

The image `ghcr.io/rajasardar/kubebay` is signed keylessly with cosign by the repository's `publish` workflow, and has a GitHub build-provenance attestation. Check a tag (or, better, the digest you deploy) before installing:

```bash
cosign verify ghcr.io/rajasardar/kubebay:v0.8.0 \
  --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/publish\.yml@refs/(heads/main|tags/v.+)$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

gh attestation verify oci://ghcr.io/rajasardar/kubebay:v0.8.0 --repo RajaSardar/kubebay
```

To enforce it, give Kyverno or Sigstore policy-controller the same identity, for example a Kyverno `verifyImages` keyless attestor with that subject regexp and issuer. Once it runs, Kubebay's own "Running image signatures" check on the RBAC page shows the image as verified against that policy.
