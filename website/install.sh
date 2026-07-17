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
  darwin|linux) ;;
  *)
    echo "Unsupported OS: $OS"
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
ACTUAL=$(sha256sum "/tmp/$ARCHIVE" | awk '{print $1}')

if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch!"
  echo "  Expected: $EXPECTED"
  echo "  Actual:   $ACTUAL"
  exit 1
fi

echo "Installing to /usr/local/bin/myairouter..."
tar -xzf "/tmp/$ARCHIVE" -C /tmp
sudo mv "/tmp/myairouter-${OS}-${ARCH}" /usr/local/bin/myairouter 2>/dev/null || sudo mv "/tmp/myairouter-${OS}-${ARCH}.exe" /usr/local/bin/myairouter
chmod +x /usr/local/bin/myairouter

rm -f "/tmp/$ARCHIVE" "/tmp/checksums.txt"

echo "Installed myairouter $VERSION"
