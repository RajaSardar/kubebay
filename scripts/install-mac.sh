#!/usr/bin/env bash
# Kubebay macOS installer
# Usage:
#   curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install-mac.sh | bash
#   curl -fsSL https://...install-mac.sh | bash -s v0.1.5   # specific version
set -euo pipefail

VERSION="${1:-}"
INSTALL_DIR="/Applications"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# ── resolve version ────────────────────────────────────────────────────────────
if [ -z "$VERSION" ]; then
  echo "Fetching latest Kubebay release..."
  VERSION=$(curl -fsSL "https://api.github.com/repos/RajaSardar/kubebay/releases/latest" \
    | grep '"tag_name"' | sed -E 's/.*"([^"]+)".*/\1/')
fi
# strip leading 'v' for filenames
VER="${VERSION#v}"
echo "Installing Kubebay $VER..."

# ── download ───────────────────────────────────────────────────────────────────
DMG="Kubebay_${VER}_universal.dmg"
URL="https://github.com/RajaSardar/kubebay/releases/download/$VERSION/$DMG"
echo "Downloading $DMG..."
curl -fsSL --progress-bar -o "$TMP/$DMG" "$URL"

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

# ── strip quarantine ───────────────────────────────────────────────────────────
# This is the key step — removes the com.apple.quarantine extended attribute
# that triggers Gatekeeper when an app is downloaded via a browser.
# Files installed by a script are never quarantined in the first place,
# but we strip it defensively in case it was set during copy.
xattr -dr com.apple.quarantine "$INSTALL_DIR/Kubebay.app" 2>/dev/null || true

echo ""
echo "✓ Kubebay $VER installed to $INSTALL_DIR/Kubebay.app"
echo "  Open it from Spotlight or double-click in Finder."
