#!/bin/sh
# Kubebay installer for Linux (and the engine on macOS).
#
#   curl -fsSL https://github.com/RajaSardar/kubebay/releases/latest/download/install.sh | sh
#   wget -qO- https://github.com/RajaSardar/kubebay/releases/latest/download/install.sh | sh
#
# With no options it installs the engine: one binary that serves the app to
# your browser, for Linux or macOS on x86_64 or arm64. Options (after `sh -s --`):
#
#   --desktop     install the desktop app instead (Linux x86_64): the .deb through
#                 apt on Debian and Ubuntu, so apt installs WebKitGTK with it,
#                 otherwise the AppImage. On a Mac, use install-mac.sh.
#   --appimage    with --desktop, install the AppImage even where apt exists.
#   vX.Y.Z        install that release instead of the latest.
#
# Environment: KUBEBAY_INSTALL_DIR (where the engine or AppImage goes; default
# ~/.local/bin, or /usr/local/bin as root), KUBEBAY_INSTALL_UNVERIFIED=1
# (install a release that publishes no checksum).
#
# Before it installs anything it checks the download against the SHA-256 the
# release publishes next to it, and against the release's keyless cosign
# signature too when `cosign` is installed. A mismatch stops it with nothing changed.
set -eu

REPO="RajaSardar/kubebay"
VERSION=""
DESKTOP=0
APPIMAGE=0

die() { echo "error: $*" >&2; exit 1; }
say() { echo "$*"; }

for arg in "$@"; do
  case "$arg" in
    --desktop) DESKTOP=1 ;;
    --appimage) APPIMAGE=1 ;;
    -h|--help)
      say "usage: install.sh [--desktop [--appimage]] [vX.Y.Z]"
      say "  (no options)  the engine, into ~/.local/bin (/usr/local/bin as root)"
      say "  --desktop     the Linux desktop app: the .deb via apt, else the AppImage"
      say "  --appimage    with --desktop, the AppImage even where apt exists"
      exit 0 ;;
    -*) die "unknown option $arg (use --desktop, --appimage or a version like v0.9.0)" ;;
    *) VERSION="$arg" ;;
  esac
done
[ -n "$VERSION" ] || VERSION="${KUBEBAY_VERSION:-}"

# ── this machine ───────────────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  *) die "Kubebay has no build for $(uname -s). On Windows, use the installer from https://github.com/$REPO/releases/latest" ;;
esac
M="$(uname -m)"
case "$M" in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "Kubebay has no build for the $M CPU (it has x86_64 and arm64)" ;;
esac

if [ "$DESKTOP" = 1 ]; then
  [ "$OS" = darwin ] && die "on a Mac, install the desktop app with: curl -fsSL https://github.com/$REPO/releases/latest/download/install-mac.sh | bash"
  [ "$ARCH" = amd64 ] || die "the Linux desktop app is built for x86_64 only. Run this script without --desktop to install the engine, which runs on arm64 and serves the app to your browser."
fi

# ── downloads ──────────────────────────────────────────────────────────────────
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "this needs curl or wget to download Kubebay (sudo apt-get install -y curl)"
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

# ── version ────────────────────────────────────────────────────────────────────
if [ -z "$VERSION" ]; then
  say "Finding the latest Kubebay release..."
  fetch "https://api.github.com/repos/$REPO/releases/latest" "$TMP/latest.json" \
    || die "couldn't reach the GitHub API to find the latest release. Name one instead: sh -s -- v0.9.0"
  VERSION="$(grep '"tag_name"' "$TMP/latest.json" | head -n 1 | sed 's/.*"tag_name"[^"]*"\([^"]*\)".*/\1/')"
fi
# The version goes into a URL and a file name, so it has to look like one.
case "$VERSION" in
  ""|*[!0-9A-Za-z.-]*) die "'$VERSION' is not a release version like v0.9.0" ;;
esac
printf '%s\n' "$VERSION" | grep -Eq '^v?[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z]+)*$' \
  || die "'$VERSION' is not a release version like v0.9.0"
VER="${VERSION#v}"
TAG="v$VER"
BASE="https://github.com/$REPO/releases/download/$TAG"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else die "this needs sha256sum or shasum to check the download"; fi
}

# download NAME: fetch a release asset into $TMP and check it.
download() {
  name="$1"
  say "Downloading $name ($TAG)..."
  fetch "$BASE/$name" "$TMP/$name" || die "couldn't download $BASE/$name. Is $TAG a release with a $name?"
  if fetch "$BASE/$name.sha256" "$TMP/$name.sha256" 2>/dev/null; then
    want="$(awk '{print $1}' "$TMP/$name.sha256")"
    have="$(sha256_of "$TMP/$name")"
    { [ -n "$want" ] && [ "$want" = "$have" ]; } \
      || die "the checksum of $name does not match the one the release publishes. Not installing. (expected $want, got $have)"
    say "✓ checksum matches the release"
    verified=1
  elif [ "${KUBEBAY_INSTALL_UNVERIFIED:-}" = "1" ]; then
    echo "warning: this release publishes no checksum for $name; installing unverified because KUBEBAY_INSTALL_UNVERIFIED=1." >&2
    verified=0
  else
    die "this release publishes no checksum for $name, so the download can't be checked. Not installing. Set KUBEBAY_INSTALL_UNVERIFIED=1 to install anyway."
  fi
  if command -v cosign >/dev/null 2>&1; then
    if fetch "$BASE/$name.cosign.bundle" "$TMP/$name.cosign.bundle" 2>/dev/null; then
      # The signer has to be this repository's release workflow at a release tag.
      cosign verify-blob "$TMP/$name" \
        --bundle "$TMP/$name.cosign.bundle" \
        --certificate-identity-regexp '^https://github\.com/RajaSardar/kubebay/\.github/workflows/release\.yml@refs/tags/v' \
        --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null 2>&1 \
        || die "the cosign signature of $name is not valid for this repository's release workflow. Not installing."
      say "✓ cosign signature is valid"
    elif [ "$verified" != 1 ]; then
      echo "warning: no cosign signature published either." >&2
    fi
  fi
}

if [ "$(id -u)" = 0 ]; then
  ROOT=1; DEFAULT_DIR=/usr/local/bin
else
  ROOT=0; DEFAULT_DIR="$HOME/.local/bin"
fi
BIN_DIR="${KUBEBAY_INSTALL_DIR:-$DEFAULT_DIR}"

path_hint() {
  case ":$PATH:" in
    *":$BIN_DIR:"*) ;;
    *) say ""
       say "  $BIN_DIR is not on your PATH. Add it, then open a new terminal:"
       say "    echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.profile" ;;
  esac
}

# ── desktop app ────────────────────────────────────────────────────────────────
if [ "$DESKTOP" = 1 ]; then
  if [ "$APPIMAGE" = 0 ] && command -v apt-get >/dev/null 2>&1; then
    DEB="Kubebay_${VER}_amd64.deb"
    download "$DEB"
    # apt reads the file as its own _apt user, so let it.
    chmod 755 "$TMP"; chmod 644 "$TMP/$DEB"
    # apt-get, not dpkg -i: apt installs the WebKitGTK and GTK libraries the app needs.
    if [ "$ROOT" = 1 ]; then
      apt-get install -y "$TMP/$DEB"
    elif command -v sudo >/dev/null 2>&1; then
      say "Installing with apt (it asks for your password)..."
      sudo apt-get install -y "$TMP/$DEB"
    else
      die "installing the .deb needs root, and sudo isn't installed. Run this as root, or add --appimage to install without root."
    fi
    say ""
    say "✓ Kubebay $VER installed. Open it from your applications menu, or run: kubebay"
    say "  Remove it with: sudo apt-get remove kubebay"
    exit 0
  fi

  APP="Kubebay_${VER}_amd64.AppImage"
  download "$APP"
  mkdir -p "$BIN_DIR"
  mv "$TMP/$APP" "$BIN_DIR/kubebay-desktop"
  chmod 755 "$BIN_DIR/kubebay-desktop"
  APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$APPS"
  cat > "$APPS/kubebay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Kubebay
Comment=Local-first Kubernetes IDE
Exec=$BIN_DIR/kubebay-desktop
Icon=kubebay
Terminal=false
Categories=Development;
EOF
  say ""
  say "✓ Kubebay $VER installed to $BIN_DIR/kubebay-desktop, with an entry in your applications menu."
  say "  AppImages need FUSE 2: on Ubuntu 24.04 run  sudo apt-get install -y libfuse2t64  (22.04: libfuse2)."
  say "  Without it, start it with: APPIMAGE_EXTRACT_AND_RUN=1 $BIN_DIR/kubebay-desktop"
  path_hint
  exit 0
fi

# ── engine ─────────────────────────────────────────────────────────────────────
TGZ="kubebay-$OS-$ARCH.tar.gz"
download "$TGZ"
tar -xzf "$TMP/$TGZ" -C "$TMP"
[ -f "$TMP/kubebay-$OS-$ARCH/kubebay" ] || die "$TGZ has no kubebay binary in it"
mkdir -p "$BIN_DIR" 2>/dev/null || die "can't create $BIN_DIR. Set KUBEBAY_INSTALL_DIR to a folder you can write to, or run with sudo."
[ -w "$BIN_DIR" ] || die "can't write to $BIN_DIR. Set KUBEBAY_INSTALL_DIR to a folder you can write to, or run with sudo."
chmod 755 "$TMP/kubebay-$OS-$ARCH/kubebay"
mv -f "$TMP/kubebay-$OS-$ARCH/kubebay" "$BIN_DIR/kubebay"

say ""
say "✓ Kubebay $VER (engine) installed to $BIN_DIR/kubebay"
say ""
say "  Start it:  kubebay"
say "  Then open http://127.0.0.1:9898 and paste the token it prints the path of"
say "  (~/.config/kubebay/session-token). On a server, add --no-open."
say "  Remove it: rm $BIN_DIR/kubebay"
path_hint
