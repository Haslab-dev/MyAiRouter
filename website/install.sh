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
  linux|darwin) ;;
  *)
    echo "Unsupported OS: $OS (only Linux and macOS are currently supported for automatic binary releases)"
    exit 1
    ;;
esac

# Parse flags
LOCAL_ONLY=false
REMOTE_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --local|-l)  LOCAL_ONLY=true ;;
    --remote|-r) REMOTE_ONLY=true ;;
  esac
done

# Detect local binary if present
LOCAL_BIN=""
if [ "$REMOTE_ONLY" = false ]; then
  if [ -f "./myairouter" ]; then
    LOCAL_BIN="./myairouter"
  elif [ -f "./myAiRouter" ]; then
    LOCAL_BIN="./myAiRouter"
  elif [ -f "../myairouter" ]; then
    LOCAL_BIN="../myairouter"
  elif [ -f "../myAiRouter" ]; then
    LOCAL_BIN="../myAiRouter"
  elif [ "$LOCAL_ONLY" = true ]; then
    echo "Building local binary..."
    if [ -f "Makefile" ]; then
      make build
    else
      (cd web && npm run build) && go build -o myairouter .
    fi
    LOCAL_BIN="./myairouter"
  fi
fi

INSTALL_DIR="${INSTALL_DIR:-}"
SUDO=""

if [ -z "$INSTALL_DIR" ]; then
  if [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
  elif [ "${USE_SUDO:-false}" = "true" ] && command -v sudo >/dev/null 2>&1 && [ -t 0 ]; then
    INSTALL_DIR="/usr/local/bin"
    SUDO="sudo"
  else
    INSTALL_DIR="$HOME/.local/bin"
  fi
fi
mkdir -p "$INSTALL_DIR"

if [ -n "$LOCAL_BIN" ]; then
  echo "Replacing existing installation if running..."
  if command -v pkill >/dev/null 2>&1; then
    pkill -f "$INSTALL_DIR/myairouter" 2>/dev/null || true
    pkill -f "$INSTALL_DIR/myAiRouter" 2>/dev/null || true
  fi
  echo "Installing local binary ($LOCAL_BIN) to $INSTALL_DIR/myairouter (replacing old version)..."
  $SUDO rm -f "$INSTALL_DIR/myairouter" "$INSTALL_DIR/myAiRouter"
  $SUDO cp "$LOCAL_BIN" "$INSTALL_DIR/myairouter"
  $SUDO chmod +x "$INSTALL_DIR/myairouter"
  echo "Successfully installed local myairouter to $INSTALL_DIR/myairouter"
  exit 0
fi

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

INSTALL_DIR="${INSTALL_DIR:-}"
SUDO=""

if [ -z "$INSTALL_DIR" ]; then
  if [ -w "/usr/local/bin" ]; then
    INSTALL_DIR="/usr/local/bin"
  elif [ "${USE_SUDO:-false}" = "true" ] && command -v sudo >/dev/null 2>&1 && [ -t 0 ]; then
    INSTALL_DIR="/usr/local/bin"
    SUDO="sudo"
  else
    INSTALL_DIR="$HOME/.local/bin"
  fi
fi
mkdir -p "$INSTALL_DIR"

echo "Replacing existing installation if running..."
if command -v pkill >/dev/null 2>&1; then
  pkill -f "$INSTALL_DIR/myairouter" 2>/dev/null || true
  pkill -f "$INSTALL_DIR/myAiRouter" 2>/dev/null || true
fi

echo "Installing to $INSTALL_DIR/myairouter (replacing old version)..."
tar -xzf "/tmp/$ARCHIVE" -C /tmp
$SUDO rm -f "$INSTALL_DIR/myairouter" "$INSTALL_DIR/myAiRouter"
$SUDO mv "/tmp/myairouter-${OS}-${ARCH}" "$INSTALL_DIR/myairouter"
$SUDO chmod +x "$INSTALL_DIR/myairouter"

rm -f "/tmp/$ARCHIVE" "/tmp/checksums.txt"

echo "Successfully installed myairouter $VERSION to $INSTALL_DIR/myairouter"
