---
title: Air-gapped installs
description: Install Kubebay in a cluster with no internet access, from one signed bundle.
section: Reference
order: 3
appRoutes: []
---

Each release from v0.8 has a `kubebay-airgap-<version>.tar.gz` asset with everything the [in-cluster install](/docs/install/#in-a-cluster) needs, and nothing it has to download. Kubebay has no account, licence server or phone-home, so once the image is inside, it runs as it would anywhere else.

## What's in the bundle

```text
kubebay-airgap-v0.8.0/
  README.md                                this guide
  chart/kubebay-0.8.0.tgz                  the Helm chart, its image pinned to v0.8.0
  images/kubebay-v0.8.0.oci.tar            the image for linux/amd64 and linux/arm64
  images/kubebay-v0.8.0-linux-amd64.tar    one platform, for docker load or ctr import
  images/kubebay-v0.8.0-linux-arm64.tar
  SHA256SUMS                               a checksum of every file above
  SHA256SUMS.cosign.bundle                 a keyless signature of SHA256SUMS
```

## 1. Check it before you carry it in

```bash
cosign verify-blob kubebay-airgap-v0.8.0.tar.gz \
  --bundle kubebay-airgap-v0.8.0.tar.gz.cosign.bundle \
  --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify kubebay-airgap-v0.8.0.tar.gz --repo RajaSardar/kubebay
```

## 2. Check what arrived

```bash
tar -xzf kubebay-airgap-v0.8.0.tar.gz
cd kubebay-airgap-v0.8.0
sha256sum -c SHA256SUMS          # macOS: shasum -a 256 -c SHA256SUMS
```

To check the manifest itself inside the air gap, run `cosign verify-blob SHA256SUMS --bundle SHA256SUMS.cosign.bundle` with the identity flags above, plus `--offline` and a Sigstore trusted root you brought in (`--trusted-root`).

## 3. Load the image

Push it to the registry your cluster pulls from, keeping every platform:

```bash
skopeo copy --all oci-archive:images/kubebay-v0.8.0.oci.tar docker://registry.example.internal/kubebay:v0.8.0
```

Or, without a registry, import the archive for your nodes' platform on each node:

```bash
docker load -i images/kubebay-v0.8.0-linux-amd64.tar                    # Docker
sudo ctr -n k8s.io images import images/kubebay-v0.8.0-linux-amd64.tar  # containerd
sudo k3s ctr images import images/kubebay-v0.8.0-linux-amd64.tar        # k3s
```

The per-platform archives name the image `ghcr.io/rajasardar/kubebay:v0.8.0`, as the chart does. Importing on each node needs `image.pullPolicy=IfNotPresent`, the chart's default.

## 4. Install the chart

```bash
helm install kubebay chart/kubebay-0.8.0.tgz \
  --namespace kubebay --create-namespace \
  --set image.repository=registry.example.internal/kubebay
```

With images imported on the nodes, leave `image.repository` as it is.

## Inside the air gap

- **Image signatures**: the running-image signature check needs Sigstore's trusted root. Without network access it uses the last copy it verified. With none, it reports keyless signatures as "not checked", never as verified.
- **Upgrades**: bring in the next release's bundle and repeat these steps. `helm upgrade` with the new chart picks up the new image.
