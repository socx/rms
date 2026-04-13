#!/usr/bin/env bash
set -euo pipefail

# Usage: ./infra/scripts/generate-dev-certs.sh [out-dir]
OUT_DIR="${1:-infra/dev-certs}"
KEY="$OUT_DIR/dev.key"
CRT="$OUT_DIR/dev.crt"

mkdir -p "$OUT_DIR"

echo "Generating self-signed certificate in $OUT_DIR..."

openssl req -x509 -nodes -newkey rsa:4096 -sha256 -days 365 \
  -subj "/CN=localhost" \
  -keyout "$KEY" -out "$CRT"

chmod 600 "$KEY" || true
chmod 644 "$CRT" || true

cat <<EOF
Created development certs:
  key: $PWD/$KEY
  cert: $PWD/$CRT

To use them in your shell:
  export SSL_KEY_PATH=$PWD/$KEY
  export SSL_CERT_PATH=$PWD/$CRT
  export SSL_PORT=3443

Then start services:
  npm run dev
EOF
