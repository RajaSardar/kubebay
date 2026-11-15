#!/usr/bin/env bash
# Kubebay macOS installer
# Usage:
#   curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install-mac.sh | bash
#   curl -fsSL https://...install-mac.sh | bash -s v0.1.5   # specific version
#
# Before it replaces the app, it checks the download:
#   - the SHA-256 the release publishes next to the DMG, always;
#   - the release's keyless cosign signature too, when `cosign` is installed.
# A release with no published checksum is refused, unless you set
# KUBEBAY_INSTALL_UNVERIFIED=1 to install without checking.
set -euo pipefail

VERSION="${1:-}"
INSTALL_DIR="${KUBEBAY_INSTALL_DIR:-/Applications}"
REPO="RajaSardar/kubebay"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

die() { echo "error: $*" >&2; exit 1; }

# ── resolve version ────────────────────────────────────────────────────────────
if [ -z "$VERSION" ]; then
  echo "Fetching latest Kubebay release..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
fi
# The version goes into a URL and a file name, so it has to look like one.
[[ "$VERSION" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$ ]] || die "'$VERSION' is not a release version like v0.9.0"
# strip leading 'v' for filenames
VER="${VERSION#v}"
echo "Installing Kubebay $VER..."

# ── download ───────────────────────────────────────────────────────────────────
DMG="Kubebay_${VER}_universal.dmg"
BASE="https://github.com/$REPO/releases/download/$VERSION"
echo "Downloading $DMG..."
curl -fsSL --progress-bar -o "$TMP/$DMG" "$BASE/$DMG"

# ── verify ─────────────────────────────────────────────────────────────────────
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

if curl -fsSL -o "$TMP/$DMG.sha256" "$BASE/$DMG.sha256" 2>/dev/null; then
  want=$(awk '{print $1}' "$TMP/$DMG.sha256")
  have=$(sha256_of "$TMP/$DMG")
  [ -n "$want" ] && [ "$want" = "$have" ] \
    || die "the checksum of $DMG does not match the one the release publishes. Not installing. (expected $want, got $have)"
  echo "✓ checksum matches the release"
  VERIFIED=1
elif [ "${KUBEBAY_INSTALL_UNVERIFIED:-}" = "1" ]; then
  echo "warning: this release publishes no checksum for $DMG; installing unverified because KUBEBAY_INSTALL_UNVERIFIED=1." >&2
  VERIFIED=0
else
  die "this release publishes no checksum for $DMG, so the download can't be checked. Not installing. Set KUBEBAY_INSTALL_UNVERIFIED=1 to install anyway."
fi

if command -v cosign >/dev/null 2>&1; then
  if curl -fsSL -o "$TMP/$DMG.cosign.bundle" "$BASE/$DMG.cosign.bundle" 2>/dev/null; then
    # The signing identity has to be this repository's release workflow at a release tag.
    cosign verify-blob "$TMP/$DMG" \
      --bundle "$TMP/$DMG.cosign.bundle" \
      --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/release\.yml@refs/tags/v' \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null 2>&1 \
      || die "the cosign signature of $DMG is not valid for this repository's release workflow. Not installing."
    echo "✓ cosign signature is valid"
  elif [ "$VERIFIED" != "1" ]; then
    echo "warning: no cosign signature published either." >&2
  fi
else
  echo "tip: install cosign to also check the release's signature (https://docs.sigstore.dev/cosign/)."
fi

# ── mount and copy ─────────────────────────────────────────────────────────────
MOUNT="$TMP/mnt"
mkdir -p "$MOUNT"
hdiutil attach "$TMP/$DMG" -mountpoint "$MOUNT" -quiet -nobrowse

if [ -d "$INSTALL_DIR/Kubebay.app" ]; then
  echo "Replacing existing Kubebay.app..."
  rm -rf "$INSTALL_DIR/Kubebay.app"
fi

cp -R "$MOUNT/Kubebay.app" "$INSTALL_DIR/"
hdiutil detach "$MOUNT" -quiet

# ── clear the quarantine flag ──────────────────────────────────────────────────
# The app is not Apple-notarized yet, so Gatekeeper would refuse to open it on first
# launch. Clearing the quarantine attribute is how this installer gets past that, and
# it only happens after the checks above.
xattr -dr com.apple.quarantine "$INSTALL_DIR/Kubebay.app" 2>/dev/null || true

echo ""
echo "✓ Kubebay $VER installed to $INSTALL_DIR/Kubebay.app"
echo "  Open it from Spotlight or double-click in Finder."
