#!/usr/bin/env bash
set -euo pipefail

REPO="haslab-dev/MyAiRouter"
REPO_URL="https://haslab-dev.github.io/MyAiRouter"
R2_PUBLIC_URL="${R2_PUBLIC_URL:-https://pub-e9f8e24ea55741c2b8339e9e52d47d05.r2.dev}"
BASE_URL="${R2_PUBLIC_URL}/releases"

OS=$(uname | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
  x86_64)  ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
  arm64)   ARCH=arm64 ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  linux) ;;
  *)
    echo "Unsupported OS: $OS (only Linux is currently supported for automatic binary releases)"
    exit 1
    ;;
esac

echo "Fetching latest version..."
VERSION=$(curl -fsSL "$BASE_URL/latest.json" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')

if [ -z "$VERSION" ]; then
  echo "Could not determine latest version"
  exit 1
fi

echo "Downloading myairouter $VERSION for $OS/$ARCH..."
ARCHIVE="myairouter-${OS}-${ARCH}.tar.gz"
curl -fL "$BASE_URL/$ARCHIVE" -o "/tmp/$ARCHIVE"

echo "Verifying checksum..."
curl -fL "$BASE_URL/checksums.txt" -o "/tmp/checksums.txt"
EXPECTED=$(grep "$ARCHIVE" "/tmp/checksums.txt" | awk '{print $1}')

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL=$(sha256sum "/tmp/$ARCHIVE" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL=$(shasum -a 256 "/tmp/$ARCHIVE" | awk '{print $1}')
elif command -v openssl >/dev/null 2>&1; then
  ACTUAL=$(openssl dgst -sha256 "/tmp/$ARCHIVE" | awk '{print $2}')
else
  echo "Error: no SHA256 checksum tool available (sha256sum, shasum, openssl)"
  exit 1
fi

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch!"
  echo "  Expected: $EXPECTED"
  echo "  Actual:   $ACTUAL"
  exit 1
fi

INSTALL_DIR="/usr/local/bin"
SUDO=""

if [ ! -w "$INSTALL_DIR" ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
  fi
fi

echo "Installing to $INSTALL_DIR/myairouter..."
tar -xzf "/tmp/$ARCHIVE" -C /tmp
$SUDO mv "/tmp/myairouter-${OS}-${ARCH}" "$INSTALL_DIR/myairouter"
$SUDO chmod +x "$INSTALL_DIR/myairouter"

rm -f "/tmp/$ARCHIVE" "/tmp/checksums.txt"

echo "Successfully installed myairouter $VERSION to $INSTALL_DIR/myairouter"
